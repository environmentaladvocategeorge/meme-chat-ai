import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { streamAgent } from "./agent/streamAgent";
import type { AgentUsage } from "./agent/types";
import { GET_GIF_TOOL, runGetGif } from "./gifs/getGifTool";
import { GET_MEME_TOOL, runGetMeme } from "./memes/getMemeTool";
import type { MessageGif } from "./messages/messageGif";
import type { MessageImage } from "./messages/messageImage";
import { stripMemeArtifacts } from "./messages/sanitizeAgentText";
import { chargeCredits, evaluateQuota } from "./billing/ledger";
import { calculateCostUsd, calculateCredits } from "./billing/credits";
import { resolveModelId } from "./billing/models";
import { checkIpRateLimit, extractClientIp } from "./billing/rateLimit";
import { chooseModel } from "./billing/router";
import { assembleContext } from "./context/assemble";
import { IMAGE_TOKENS_LOW } from "./context/tokens";
import {
  appendMessage,
  assertConversationOwner,
  createConversation,
  finalizeAgentMessage,
  markAgentMessageErrored,
} from "./conversations/repository";
import { loadEntitlement } from "./entitlement/loadEntitlement";
import {
  isOwnedMessageImagePath,
  summarizeImagesForLog,
} from "./messages/messageImage";
import {
  deleteUploadObjects,
  resolveImageInputs,
} from "./messages/resolveImageInputs";
import { summarizeGifsForLog } from "./messages/messageGif";
import { buildSystemPromptForStream } from "./personas/prompts";
import { streamAgentRequestSchema } from "./streamAgentRequest";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
// The Klipy app key powering the agent's get_meme tool. Optional: when it isn't
// configured the tool is simply not offered and the agent replies text-only.
const KLIPY_APP_KEY = defineSecret("KLIPY_APP_KEY");

type SseResponse = {
  write: (chunk: string) => unknown;
};

function getBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function writeSse(res: SseResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function markErroredSafely(conversationId: string, messageId: string) {
  try {
    await markAgentMessageErrored(conversationId, messageId);
  } catch (err) {
    logger.error("[streamAgentAnswer] failed to mark message errored", {
      conversationId,
      messageId,
      err,
    });
  }
}

// TODO: enable `enforceAppCheck: true` here once the mobile client integrates
// the Firebase App Check SDK. Until then, leaving it off keeps emulator and
// existing builds working. The per-IP rate limit below provides interim
// abuse protection.
export const streamAgentAnswer = onRequest(
  {
    secrets: [OPENAI_API_KEY, KLIPY_APP_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
    cors: false,
    invoker: "public",
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).end();
      return;
    }

    // Per-IP rate limit closes the loophole where a single client creates
    // many free-tier accounts and hammers the endpoint.
    const clientIp = extractClientIp({
      forwarded: req.header("x-forwarded-for"),
      realIp: req.header("x-real-ip"),
      fallback: req.ip,
    });
    const allowed = await checkIpRateLimit(clientIp);
    if (!allowed) {
      logger.warn("[streamAgentAnswer] rate-limited", { ip: clientIp });
      res.status(429).json({ code: "rate_limited" });
      return;
    }

    const token = getBearerToken(req.header("authorization"));
    if (!token) {
      res.status(401).end();
      return;
    }

    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(token, true);
      uid = decoded.uid;
    } catch (err) {
      logger.warn("[streamAgentAnswer] invalid auth token", { err });
      res.status(401).end();
      return;
    }

    const parsed = streamAgentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_request" });
      return;
    }

    const userText = parsed.data.message.trim();
    const images = parsed.data.images;
    const gifs = parsed.data.gifs;
    const currentGif = gifs[0];
    const personaId = parsed.data.personaId;
    const clientMessageId = parsed.data.clientMessageId;
    const levelOfRot = parsed.data.levelOfRot;

    // Log only safe, URL-free attachment metadata (count/hosts/source/mime).
    // Never log full asset URLs.
    if (images.length > 0) {
      logger.info("[streamAgentAnswer] received image attachments", {
        ...summarizeImagesForLog(images),
      });
    }
    if (gifs.length > 0) {
      logger.info("[streamAgentAnswer] received gif attachment", {
        ...summarizeGifsForLog(gifs),
      });
    }

    // ---------- resolve conversation ----------
    let conversationId = parsed.data.conversationId;
    const newConversation = !conversationId;
    try {
      if (conversationId) {
        await assertConversationOwner(conversationId, uid);
      } else {
        const created = await createConversation(uid, userText, {
          hasImages: images.length > 0 || gifs.length > 0,
        });
        conversationId = created.conversationId;
      }
    } catch {
      res.status(404).json({ code: "not_found" });
      return;
    }

    // ---------- entitlement ----------
    let entitlement;
    try {
      entitlement = await loadEntitlement(uid);
    } catch (err) {
      logger.error("[streamAgentAnswer] entitlement load failed", {
        conversationId,
        err,
      });
      res.status(500).json({ code: "internal" });
      return;
    }

    // ---------- quota gate (read-only) ----------
    // No credits are reserved up front. We only refuse a turn when the user
    // has already exhausted a window; the real cost is charged after the
    // stream (see chargeForUsage), so the displayed balance moves exactly once.
    const quota = evaluateQuota({ state: entitlement, plan: entitlement.plan });
    if (!quota.ok) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      writeSse(res, "quota_exceeded", {
        reason: quota.reason,
        resetAt: quota.resetAt?.toISOString() ?? null,
      });
      res.end();
      return;
    }

    // ---------- resolve + moderate image inputs ----------
    // Ownership re-check (the zod schema can't see uid): every upload path must
    // live under this caller's namespace. Client validation is UX-only.
    const ownershipOk = images.every(
      (img) =>
        img.source !== "upload" || isOwnedMessageImagePath(uid, img.path),
    );
    if (!ownershipOk) {
      logger.warn("[streamAgentAnswer] rejected unowned upload path", { uid });
      res.status(400).json({ code: "invalid_request" });
      return;
    }

    // Ingest uploads by Storage path (Admin SDK), downscale to the model copy,
    // and run the moderation gate. Klipy images pass through by URL. Done before
    // anything is persisted, so a rejected turn writes nothing.
    let currentImageUrls: string[];
    try {
      const resolved = await resolveImageInputs(
        uid,
        images,
        OPENAI_API_KEY.value(),
      );
      if (!resolved.ok) {
        if (resolved.reason === "moderation") {
          await deleteUploadObjects(resolved.rejectedPaths);
          res.status(400).json({ code: "image_rejected" });
          return;
        }
        res.status(502).json({ code: "image_unavailable" });
        return;
      }
      currentImageUrls = resolved.modelImageUrls;
    } catch (err) {
      logger.error("[streamAgentAnswer] image resolution failed", {
        conversationId,
        err,
      });
      res.status(500).json({ code: "internal" });
      return;
    }

    // ---------- routing + context ----------
    let internalModel;
    let assembleResult;
    let resolvedPersona:
      | Awaited<ReturnType<typeof buildSystemPromptForStream>>["persona"]
      | null = null;
    const klipyApiKey = KLIPY_APP_KEY.value();
    const memeToolEnabled = klipyApiKey.length > 0;
    try {
      internalModel = chooseModel(entitlement.plan);
      const promptResult = await buildSystemPromptForStream(personaId, levelOfRot);
      resolvedPersona = promptResult.persona;
      // The persona prompt itself carries the get_gif / get_meme usage rules,
      // so no extra tool guidance is appended here. `memeToolEnabled` still
      // gates whether the tools are actually registered below.
      const systemPrompt = promptResult.systemPrompt;
      assembleResult = await assembleContext({
        conversationId,
        plan: entitlement.plan,
        currentUserMessage: userText,
        currentImageUrls,
        currentGif,
        systemPrompt,
      });
    } catch (err) {
      logger.error("[streamAgentAnswer] preflight failed", { conversationId, err });
      res.status(500).json({ code: "internal" });
      return;
    }

    // ---------- stream ----------
    let agentMessageId: string | null = null;
    let finalized = false;
    let clientClosed = false;
    let sawDelta = false;
    let lastUsage: AgentUsage | null = null;
    // The meme / GIF the agent attached via get_meme / get_gif this turn, if
    // any. Persisted on the agent message at finalize and emitted to the client
    // over SSE. At most one is set (the guidance says pick one).
    let agentMeme: MessageImage | null = null;
    let agentGif: MessageGif | null = null;
    const abortController = new AbortController();

    // Charge the turn's real cost once the stream's final usage is known.
    // There is nothing to reserve or release: if no usage ever arrived (e.g.
    // the client aborted before any output), the turn is free.
    const chargeForUsage = async (reason: string) => {
      if (!lastUsage) return;

      // Early-rollout calibration: compare our flat image-token estimate to the
      // model's actual prompt tokens so we can tune IMAGE_TOKENS_LOW per model.
      // No image URLs are logged.
      if (images.length > 0) {
        logger.info("[streamAgentAnswer] image turn usage", {
          model: internalModel,
          imageCount: images.length,
          estimatedImageTokens: images.length * IMAGE_TOKENS_LOW,
          actualPromptTokens: lastUsage.inputTokens,
          actualTotalTokens: lastUsage.inputTokens + lastUsage.outputTokens,
          detail: "low",
        });
      }

      try {
        const costUsd = calculateCostUsd(internalModel, lastUsage);
        const credits = calculateCredits(costUsd);
        await chargeCredits(uid, entitlement.plan, {
          conversationId: conversationId!,
          messageId: agentMessageId,
          model: internalModel,
          inputTokens: lastUsage.inputTokens,
          cachedInputTokens: lastUsage.cachedInputTokens,
          outputTokens: lastUsage.outputTokens,
          reasoningTokens: lastUsage.reasoningTokens,
          costUsd,
          credits,
        });
      } catch (err) {
        logger.error("[streamAgentAnswer] charge failed", {
          uid,
          conversationId,
          agentMessageId,
          reason,
          err,
        });
      }
    };

    req.on("close", () => {
      if (!finalized) {
        clientClosed = true;
        abortController.abort();
      }
    });

    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const userMessage = await appendMessage(conversationId, {
        role: "user",
        text: userText,
        status: "complete",
        clientMessageId,
        images: images.length > 0 ? images : undefined,
        gifs: gifs.length > 0 ? gifs : undefined,
        levelOfRot,
      });

      if (newConversation) {
        writeSse(res, "conversation", { id: conversationId });
      }
      writeSse(res, "message", {
        role: "user",
        id: userMessage.messageId,
        clientMessageId,
      });

      const agentMessage = await appendMessage(conversationId, {
        role: "agent",
        text: "",
        status: "streaming",
        inReplyToClientMessageId: clientMessageId,
        persona: resolvedPersona
          ? {
              id: resolvedPersona.id,
              name: resolvedPersona.name,
              slug: resolvedPersona.slug,
              displayName: resolvedPersona.publicConfig.displayName,
              avatarKey: resolvedPersona.publicConfig.avatarKey,
            }
          : undefined,
      });
      agentMessageId = agentMessage.messageId;
      writeSse(res, "message", {
        role: "agent",
        id: agentMessageId,
        inReplyToClientMessageId: clientMessageId,
      });

      writeSse(res, "model", { id: internalModel });
      if (resolvedPersona) {
        // Only safe public metadata goes over SSE. Prompt content stays
        // backend-only inside assembleResult.messages[0].
        writeSse(res, "persona", {
          id: resolvedPersona.id,
          name: resolvedPersona.name,
          displayName: resolvedPersona.publicConfig.displayName,
        });
      }

      let fullText = "";
      for await (const delta of streamAgent({
        messages: assembleResult.messages,
        apiKey: OPENAI_API_KEY.value(),
        model: resolveModelId(internalModel),
        maxOutputTokens: entitlement.maxOutputTokens,
        // Offer the get_meme tool only when Klipy is configured. The runner
        // resolves Klipy internally and never throws, so a meme miss/outage
        // still yields a normal text reply.
        tools: memeToolEnabled ? [GET_GIF_TOOL, GET_MEME_TOOL] : undefined,
        runTool: memeToolEnabled
          ? (call) => {
              const klipyDeps = { apiKey: klipyApiKey, customerId: uid };
              if (call.name === "get_meme") {
                return runGetMeme(call.arguments, klipyDeps);
              }
              if (call.name === "get_gif") {
                return runGetGif(call.arguments, klipyDeps);
              }
              return Promise.resolve({
                content: JSON.stringify({ error: "unknown_tool" }),
              });
            }
          : undefined,
        signal: abortController.signal,
      })) {
        if (clientClosed) {
          await markErroredSafely(conversationId, agentMessageId);
          finalized = true;
          await chargeForUsage("client-closed");
          return;
        }

        if (delta.type === "delta") {
          sawDelta = true;
          fullText += delta.text;
          writeSse(res, "delta", { text: delta.text });
          continue;
        }

        if (delta.type === "meme") {
          // Keep the latest meme (the tool is capped to one round, so this fires
          // at most once) and stream it so the client can show it immediately,
          // before the finalized Firestore message lands.
          agentMeme = delta.image;
          writeSse(res, "meme", { image: agentMeme });
          continue;
        }

        if (delta.type === "gif") {
          // Same as the meme path, for an agent-attached GIF.
          agentGif = delta.gif;
          writeSse(res, "gif", { gif: agentGif });
          continue;
        }

        if (delta.type === "usage") {
          lastUsage = delta.usage;
          continue;
        }

        if (delta.type === "error") {
          logger.error("[streamAgentAnswer] agent stream failed", {
            // Renamed off `message` — the logger reserves that field and was
            // overwriting the real agent error with the log title.
            agentError: delta.message,
            sawDelta,
          });
          writeSse(res, "error", { code: "agent_error" });
          res.end();
          finalized = true;
          await markErroredSafely(conversationId, agentMessageId);
          await chargeForUsage("agent-error");
          return;
        }
      }

      writeSse(res, "done", {});
      finalized = true;
      res.end();

      try {
        await finalizeAgentMessage(
          conversationId,
          agentMessageId,
          // Scrub any meme markdown/attachment artifacts the model may have
          // written; the meme/gif is persisted + shown as its own image below.
          stripMemeArtifacts(fullText),
          agentMeme ? [agentMeme] : undefined,
          agentGif ? [agentGif] : undefined,
        );
      } catch (err) {
        logger.error("[streamAgentAnswer] failed to finalize agent message", {
          conversationId,
          agentMessageId,
          err,
        });
        await markErroredSafely(conversationId, agentMessageId);
      }
      await chargeForUsage("done");
    } catch (err) {
      logger.error("[streamAgentAnswer] request failed", {
        conversationId,
        agentMessageId,
        err,
      });

      if (res.headersSent) {
        writeSse(res, "error", { code: "agent_error" });
        res.end();
        if (conversationId && agentMessageId) {
          await markErroredSafely(conversationId, agentMessageId);
        }
        finalized = true;
        await chargeForUsage("exception-after-headers");
        return;
      }

      res.status(500).json({ code: "internal" });
      await chargeForUsage("exception-before-headers");
    }
  },
);
