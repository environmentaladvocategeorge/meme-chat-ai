import { getAuth } from "firebase-admin/auth";
import { createHash } from "crypto";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { randomReplaySampling } from "./agent/replaySampling";
import { streamAgent } from "./agent/streamAgent";
import { buildDeciderContext, decideMedia } from "./agent/decideMedia";
import { MemoryService } from "./agent/memory";
import type { AgentUsage } from "./agent/types";
import { extractGifFrames, type ExtractedGifFrames } from "./gifs/extractFrames";
import { runGetGif } from "./gifs/getGifTool";
import { runGetMeme } from "./memes/getMemeTool";
import type { MessageGif } from "./messages/messageGif";
import type { MessageImage } from "./messages/messageImage";
import { stripMemeArtifacts } from "./messages/sanitizeAgentText";
import { chargeCredits, evaluateQuota, type ModelUsage } from "./billing/ledger";
import { calculateCostUsd, calculateCredits } from "./billing/credits";
import { resolveModelId } from "./billing/models";
import { checkIpRateLimit, extractClientIp } from "./billing/rateLimit";
import { chooseModel } from "./billing/router";
import { assembleContext } from "./context/assemble";
import { IMAGE_TOKENS_LOW } from "./context/tokens";
import {
  appendMessage,
  assertConversationOwner,
  deleteMessage,
  finalizeAgentMessage,
  loadRecentMessages,
  loadReplayTargets,
  markAgentMessageErrored,
} from "./conversations/repository";
import { loadEntitlement } from "./entitlement/loadEntitlement";
import {
  isOwnedMessageImagePath,
  summarizeImagesForLog,
} from "./messages/messageImage";
import { resolveTrustedImageInputs } from "./messages/resolveImageInputs";
import { summarizeGifsForLog } from "./messages/messageGif";
import {
  buildMediaDeciderPrompt,
  buildSystemPromptForStream,
} from "./personas/prompts";
import { streamReplayRequestSchema } from "./streamReplayRequest";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const KLIPY_APP_KEY = defineSecret("KLIPY_APP_KEY");

// One reusable, stateless memory-service instance per function instance.
const memoryService = new MemoryService();

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

function logKey(value: string | null): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function markErroredSafely(conversationId: string, messageId: string) {
  try {
    await markAgentMessageErrored(conversationId, messageId);
  } catch (err) {
    logger.error("[streamReplayTurn] failed to mark message errored", {
      conversationId,
      messageId,
      err,
    });
  }
}

// Turn replay. Regenerates the agent reply named by `agentMessageId`: the old
// reply is deleted and a fresh answer is streamed for the SAME user turn, nudged
// toward something different via randomized seed/top_p. The user turn (text +
// attachments + rot level) is read from Firestore, so the client never resends
// it. Billing note: the deletion touches nothing in the ledger; the new stream
// charges itself once at the end, exactly like a normal turn — so a replay
// naturally consumes quota and is never refunded.
export const streamReplayTurn = onRequest(
  {
    secrets: [OPENAI_API_KEY, KLIPY_APP_KEY],
    timeoutSeconds: 540,
    memory: "512MiB",
    minInstances: 1,
    cors: false,
    invoker: "public",
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).end();
      return;
    }

    const clientIp = extractClientIp({
      forwarded: req.header("x-forwarded-for"),
      realIp: req.header("x-real-ip"),
      fallback: req.ip,
    });
    const allowed = await checkIpRateLimit(clientIp);
    if (!allowed) {
      logger.warn("[streamReplayTurn] rate-limited", { ipKey: logKey(clientIp) });
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
      logger.warn("[streamReplayTurn] invalid auth token", { err });
      res.status(401).end();
      return;
    }

    const parsed = streamReplayRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_request" });
      return;
    }

    const conversationId = parsed.data.conversationId;
    const agentMessageId = parsed.data.agentMessageId;
    const language = parsed.data.language;

    // ---------- ownership ----------
    try {
      await assertConversationOwner(conversationId, uid);
    } catch {
      res.status(404).json({ code: "not_found" });
      return;
    }

    // ---------- resolve the turn to replay ----------
    const targets = await loadReplayTargets(conversationId, agentMessageId);
    if (!targets.found) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    // Only the most recent message may be replayed — regenerating an older reply
    // would orphan everything that came after it.
    if (!targets.isLatest) {
      res.status(409).json({ code: "not_replayable" });
      return;
    }
    if (!targets.user) {
      res.status(409).json({ code: "not_replayable" });
      return;
    }

    const userTurn = targets.user;
    const userText = userTurn.text.trim();
    const images = userTurn.images ?? [];
    const gifs = userTurn.gifs ?? [];
    const currentGif = gifs[0];
    // Reconstruct the original turn's dials: reuse the persona the deleted reply
    // was generated with so the same character answers; default rot to 2 to
    // match the request schema's default for turns stored before the dial.
    const personaId = targets.agent.personaId;
    const levelOfRot = userTurn.levelOfRot ?? 2;
    // Rebuild the original turn's local answering prefs. Absent = on (the
    // default), since the user turn only stores the OFF state.
    const respondWithEmojis = userTurn.respondWithEmojis ?? true;
    const respondWithMedia = userTurn.respondWithMedia ?? true;

    if (images.length > 0) {
      logger.info("[streamReplayTurn] replaying image turn", {
        ...summarizeImagesForLog(images),
      });
    }
    if (gifs.length > 0) {
      logger.info("[streamReplayTurn] replaying gif turn", {
        ...summarizeGifsForLog(gifs),
      });
    }

    // ---------- entitlement ----------
    let entitlement;
    try {
      entitlement = await loadEntitlement(uid);
    } catch (err) {
      logger.error("[streamReplayTurn] entitlement load failed", {
        conversationId,
        err,
      });
      res.status(500).json({ code: "internal" });
      return;
    }

    // ---------- quota gate (read-only) ----------
    // A replay is a billable turn, so it's gated exactly like a fresh message.
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

    // ---------- resolve image inputs (trusted: already moderated) ----------
    const ownershipOk = images.every(
      (img) =>
        img.source !== "upload" || isOwnedMessageImagePath(uid, img.path),
    );
    if (!ownershipOk) {
      logger.warn("[streamReplayTurn] rejected unowned upload path", {
        userKey: logKey(uid),
      });
      res.status(400).json({ code: "invalid_request" });
      return;
    }

    let currentImageUrls: string[];
    try {
      const resolved = await resolveTrustedImageInputs(uid, images);
      if (!resolved.ok) {
        // Stored uploads should always re-ingest; a failure here means the
        // object is gone or corrupt. Don't destroy the turn — surface an error.
        res.status(502).json({ code: "image_unavailable" });
        return;
      }
      currentImageUrls = resolved.modelImageUrls;
    } catch (err) {
      logger.error("[streamReplayTurn] image resolution failed", {
        conversationId,
        err,
      });
      res.status(500).json({ code: "internal" });
      return;
    }

    // ---------- routing + media decision + context ----------
    let internalModel;
    let assembleResult;
    let resolvedPersona:
      | Awaited<ReturnType<typeof buildSystemPromptForStream>>["persona"]
      | null = null;
    let decideUsage: ModelUsage | null = null;
    let pendingGif: MessageGif | null = null;
    let pendingMeme: MessageImage | null = null;
    // GIF frames decoded for the decider; reused by assembleContext so the GIF
    // is only fetched/decoded once per replay.
    let deciderGifFrames: ExtractedGifFrames | undefined;
    const klipyApiKey = KLIPY_APP_KEY.value();
    // Honor the replayed turn's "Respond with media" pref: off skips the decider.
    const mediaEnabled = klipyApiKey.length > 0 && respondWithMedia;
    try {
      internalModel = chooseModel(entitlement.plan);
      const promptResult = await buildSystemPromptForStream(
        personaId,
        levelOfRot,
        respondWithEmojis,
      );
      resolvedPersona = promptResult.persona;
      const systemPrompt = promptResult.systemPrompt;

      // Same nano media pre-step as a normal turn: decide + fetch a reaction
      // GIF/meme for the regenerated reply, so replay keeps the media beat.
      let attachedMedia:
        | { kind: "gif" | "meme"; description: string }
        | undefined;
      if (mediaEnabled) {
        const priorMessages = await loadRecentMessages(conversationId, 12);
        const { history, recentReactions } = buildDeciderContext(priorMessages);
        const currentForDecider =
          userText ||
          (images.length > 0
            ? "[user sent an image]"
            : gifs.length > 0
              ? "[user sent a GIF]"
              : "");
        // Decode the replayed turn's GIF once, reused by the decider and
        // assembleContext below.
        const currentGifFrames = currentGif
          ? await extractGifFrames(currentGif)
          : undefined;
        const deciderSystemPrompt = await buildMediaDeciderPrompt(levelOfRot);
        const { decision, usage } = await decideMedia({
          apiKey: OPENAI_API_KEY.value(),
          systemPrompt: deciderSystemPrompt,
          // Taste-only memory so the regenerated reaction can be more personal,
          // matching the normal turn path.
          memoryBlock: (
            await memoryService.getMemoryViews(uid, entitlement.plan)
          ).media,
          history,
          currentMessage: currentForDecider,
          recentReactions,
          // Hand nano the actual pixels of the replayed turn's attachments so the
          // regenerated reaction matches what the user originally sent.
          imageUrls: [...currentImageUrls, ...(currentGifFrames?.frames ?? [])],
        });
        decideUsage = usage;
        deciderGifFrames = currentGifFrames;

        if (decision.type === "gif" || decision.type === "meme") {
          const klipyDeps = { apiKey: klipyApiKey, customerId: uid };
          const rawArgs = JSON.stringify({
            query: decision.query,
            randomness_factor: decision.randomnessFactor,
          });
          try {
            if (decision.type === "gif") {
              const r = await runGetGif(rawArgs, klipyDeps);
              if (r.gif) {
                pendingGif = r.gif;
                attachedMedia = {
                  kind: "gif",
                  description: r.title ?? decision.query,
                };
              }
            } else {
              const r = await runGetMeme(rawArgs, klipyDeps);
              if (r.meme) {
                pendingMeme = r.meme;
                attachedMedia = {
                  kind: "meme",
                  description: r.title ?? decision.query,
                };
              }
            }
          } catch (err) {
            logger.warn(
              "[streamReplayTurn] media fetch failed; replying text-only",
              { conversationId, err },
            );
          }
        }
      }

      assembleResult = await assembleContext({
        conversationId,
        plan: entitlement.plan,
        currentUserMessage: userText,
        currentImageUrls,
        currentGif,
        currentGifFrames: deciderGifFrames,
        attachedMedia,
        systemPrompt,
        userAlias: entitlement.alias,
        userLanguage: language,
        // The user turn still lives in Firestore; it's passed as the current
        // turn above, so exclude it from the history window to avoid a
        // duplicate plus a trailing empty user message.
        excludeMessageIds: [userTurn.id],
      });
    } catch (err) {
      logger.error("[streamReplayTurn] preflight failed", { conversationId, err });
      res.status(500).json({ code: "internal" });
      return;
    }

    // ---------- stream ----------
    let agentMessageIdNew: string | null = null;
    let finalized = false;
    let clientClosed = false;
    let sawDelta = false;
    let oldReplyDeleted = false;
    let lastUsage: AgentUsage | null = null;
    let agentMeme: MessageImage | null = pendingMeme;
    let agentGif: MessageGif | null = pendingGif;
    const abortController = new AbortController();

    const chargeForUsage = async (reason: string) => {
      const usages: ModelUsage[] = [];
      if (
        decideUsage &&
        (decideUsage.inputTokens > 0 || decideUsage.outputTokens > 0)
      ) {
        usages.push(decideUsage);
      }
      if (lastUsage) {
        usages.push({
          model: internalModel,
          inputTokens: lastUsage.inputTokens,
          cachedInputTokens: lastUsage.cachedInputTokens,
          outputTokens: lastUsage.outputTokens,
          reasoningTokens: lastUsage.reasoningTokens,
        });
      }
      if (usages.length === 0) return;

      if (lastUsage && images.length > 0) {
        logger.info("[streamReplayTurn] image turn usage", {
          model: internalModel,
          imageCount: images.length,
          estimatedImageTokens: images.length * IMAGE_TOKENS_LOW,
          actualPromptTokens: lastUsage.inputTokens,
          actualTotalTokens: lastUsage.inputTokens + lastUsage.outputTokens,
          detail: "low",
        });
      }

      try {
        const costUsd = usages.reduce(
          (sum, u) => sum + calculateCostUsd(u.model, u),
          0,
        );
        const credits = calculateCredits(costUsd);
        await chargeCredits(uid, entitlement.plan, {
          conversationId,
          messageId: agentMessageIdNew,
          kind: "turn",
          usages,
          costUsd,
          credits,
        });
      } catch (err) {
        logger.error("[streamReplayTurn] charge failed", {
          userKey: logKey(uid),
          conversationId,
          agentMessageId: agentMessageIdNew,
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

      // Delete the old reply only now that everything is ready to stream — so a
      // preflight failure above leaves the conversation untouched. No ledger
      // change accompanies the delete.
      await deleteMessage(conversationId, agentMessageId);
      oldReplyDeleted = true;

      const agentMessage = await appendMessage(conversationId, {
        role: "agent",
        text: "",
        status: "streaming",
        inReplyToClientMessageId: userTurn.clientMessageId,
        // Keep the conversation's denormalized plan fresh on replay too.
        plan: entitlement.plan,
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
      agentMessageIdNew = agentMessage.messageId;
      writeSse(res, "message", {
        role: "agent",
        id: agentMessageIdNew,
        inReplyToClientMessageId: userTurn.clientMessageId,
      });

      writeSse(res, "model", { id: internalModel });
      if (resolvedPersona) {
        writeSse(res, "persona", {
          id: resolvedPersona.id,
          name: resolvedPersona.name,
          displayName: resolvedPersona.publicConfig.displayName,
        });
      }

      // Media-first: show the regenerated turn's chosen GIF/meme before the text.
      if (agentGif) {
        writeSse(res, "gif", { gif: agentGif });
      } else if (agentMeme) {
        writeSse(res, "meme", { image: agentMeme });
      }

      let fullText = "";
      for await (const delta of streamAgent({
        messages: assembleResult.messages,
        apiKey: OPENAI_API_KEY.value(),
        model: resolveModelId(internalModel),
        maxOutputTokens: entitlement.maxOutputTokens,
        // The whole point of replay: a fresh seed + nudged top_p so the answer
        // differs from the one we just deleted.
        sampling: randomReplaySampling(),
        // No tools: media was already decided + fetched by the nano pre-step.
        signal: abortController.signal,
      })) {
        if (clientClosed) {
          await markErroredSafely(conversationId, agentMessageIdNew);
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

        if (delta.type === "usage") {
          lastUsage = delta.usage;
          continue;
        }

        if (delta.type === "error") {
          logger.error("[streamReplayTurn] agent stream failed", {
            agentError: delta.message,
            sawDelta,
          });
          writeSse(res, "error", { code: "agent_error" });
          res.end();
          finalized = true;
          await markErroredSafely(conversationId, agentMessageIdNew);
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
          agentMessageIdNew,
          stripMemeArtifacts(fullText),
          agentMeme ? [agentMeme] : undefined,
          agentGif ? [agentGif] : undefined,
        );
      } catch (err) {
        logger.error("[streamReplayTurn] failed to finalize agent message", {
          conversationId,
          agentMessageId: agentMessageIdNew,
          err,
        });
        await markErroredSafely(conversationId, agentMessageIdNew);
      }
      await chargeForUsage("done");
    } catch (err) {
      logger.error("[streamReplayTurn] request failed", {
        conversationId,
        agentMessageId: agentMessageIdNew,
        oldReplyDeleted,
        err,
      });

      if (res.headersSent) {
        writeSse(res, "error", { code: "agent_error" });
        res.end();
        if (agentMessageIdNew) {
          await markErroredSafely(conversationId, agentMessageIdNew);
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
