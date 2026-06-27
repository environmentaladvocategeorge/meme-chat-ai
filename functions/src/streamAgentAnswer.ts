import { createHash } from "crypto";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { streamAgent } from "./agent/streamAgent";
import { buildDeciderContext, decideMedia } from "./agent/decideMedia";
import { pickBestMediaIndex } from "./agent/pickBestMedia";
import { gatherWebContext } from "./agent/webSearch";
import type { AgentUsage } from "./agent/types";
import { extractGifFrames, type ExtractedGifFrames } from "./gifs/extractFrames";
import { runGetGif } from "./gifs/getGifTool";
import { runGetMeme } from "./memes/getMemeTool";
import type { MessageGif } from "./messages/messageGif";
import type { MessageImage } from "./messages/messageImage";
import { stripMemeArtifacts } from "./messages/sanitizeAgentText";
import { lintAgentReply } from "./monitoring/outputLinters";
import { chargeCredits, evaluateQuota, type ModelUsage } from "./billing/ledger";
import { calculateCostUsd, calculateCredits } from "./billing/credits";
import { resolveModelId } from "./billing/models";
import { checkIpRateLimit, extractClientIp } from "./billing/rateLimit";
import { chooseModel } from "./billing/router";
import { IMAGE_TOKENS_LOW } from "./context/tokens";
import { Agent, type ReplyContext } from "./agent/Agent";
import { MemoryService } from "./agent/memory";
import {
  appendMessage,
  assertConversationOwner,
  createConversation,
  finalizeAgentMessage,
  loadRecentMessages,
  markAgentMessageErrored,
  markConversationFiltered,
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
import {
  buildDeciderAttachmentHint,
  collectCurrentAttachmentTitles,
} from "./messages/attachmentMeta";
import {
  buildMediaDeciderPrompt,
  PersonaAccessError,
  resolvePersonaForStream,
} from "./personas/prompts";
import { streamAgentRequestSchema } from "./streamAgentRequest";
import { authenticateStreamRequest } from "./streamAuth";
import { checkHateSpeech } from "./moderation/checkHateSpeech";
import { logFlaggedContent } from "./moderation/logFlaggedContent";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
// The Klipy app key powering the agent's get_meme tool. Optional: when it isn't
// configured the tool is simply not offered and the agent replies text-only.
const KLIPY_APP_KEY = defineSecret("KLIPY_APP_KEY");
// The Tavily key powering the web-search router pre-step. Optional: when it isn't
// configured, gatherWebContext no-ops and every turn behaves search-free.
const TAVILY_API_KEY = defineSecret("TAVILY_API_KEY");

// One reusable, stateless memory-service instance per function instance.
const memoryService = new MemoryService();

type SseResponse = {
  write: (chunk: string) => unknown;
};

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
    secrets: [OPENAI_API_KEY, KLIPY_APP_KEY, TAVILY_API_KEY],
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

    // Per-IP rate limit closes the loophole where a single client creates
    // many free-tier accounts and hammers the endpoint.
    const clientIp = extractClientIp({
      forwarded: req.header("x-forwarded-for"),
      realIp: req.header("x-real-ip"),
      fallback: req.ip,
    });
    const allowed = await checkIpRateLimit(clientIp);
    if (!allowed) {
      logger.warn("[streamAgentAnswer] rate-limited", { ipKey: logKey(clientIp) });
      res.status(429).json({ code: "rate_limited" });
      return;
    }

    const uid = await authenticateStreamRequest(req, res, "streamAgentAnswer");
    if (!uid) return;

    const parsed = streamAgentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_request" });
      return;
    }

    const userText = parsed.data.message.trim();
    const images = parsed.data.images;
    const gifs = parsed.data.gifs;
    const currentGif = gifs[0];
    // Klipy "meme name" metadata for the current turn's attachments. Empty for
    // uploads and for older clients that don't send `title`, in which case every
    // downstream use is a no-op (back-compat).
    const attachmentTitles = collectCurrentAttachmentTitles(images, gifs);
    const personaId = parsed.data.personaId;
    const clientMessageId = parsed.data.clientMessageId;
    const levelOfRot = parsed.data.levelOfRot;
    const language = parsed.data.language;
    // Local-only answering prefs (default true). emojis → prompt content;
    // media → whether the media decider runs at all.
    const respondWithEmojis = parsed.data.respondWithEmojis;
    const respondWithMedia = parsed.data.respondWithMedia;

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

    // ---------- hate speech gate ----------
    // Only runs when there is text. Attachment-only turns (memes, GIFs) are
    // not text-moderated here; images go through the OpenAI image moderation
    // pipeline below. We check only the `hate` / `hate/threatening` categories
    // so medical, firearms, and self-harm discussions pass through unblocked.
    if (userText.length > 0) {
      let hateFlagged = false;
      try {
        hateFlagged = await checkHateSpeech(userText, OPENAI_API_KEY.value());
      } catch (err) {
        logger.warn("[streamAgentAnswer] hate speech check threw; failing open", {
          conversationId,
          err,
        });
      }
      if (hateFlagged) {
        logger.warn("[streamAgentAnswer] hate speech detected in message", {
          userKey: logKey(uid),
          conversationId,
        });
        // A brand-new conversation was created above with a neutral placeholder
        // title; since the gate blocks the reply, AI titling will never run, so
        // relabel it now to a clean filtered title instead of leaving the
        // placeholder. Best-effort: a failure here must not change the response.
        if (newConversation) {
          await markConversationFiltered(conversationId).catch((err) =>
            logger.warn("[streamAgentAnswer] failed to relabel filtered conversation", {
              conversationId,
              err,
            }),
          );
        }
        void logFlaggedContent({
          uid,
          conversationId,
          messageId: clientMessageId ?? null,
          reason: "hate_speech",
          context: "message",
        });
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        writeSse(res, "hate_speech", {});
        res.end();
        return;
      }
    }

    // ---------- resolve + moderate image inputs ----------
    // Ownership re-check (the zod schema can't see uid): every upload path must
    // live under this caller's namespace. Client validation is UX-only.
    const ownershipOk = images.every(
      (img) =>
        img.source !== "upload" || isOwnedMessageImagePath(uid, img.path),
    );
    if (!ownershipOk) {
      logger.warn("[streamAgentAnswer] rejected unowned upload path", {
        userKey: logKey(uid),
      });
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

    // ---------- routing + media decision + context ----------
    let internalModel;
    let assembleResult;
    let resolvedPersona: ReplyContext["persona"] | null = null;
    // Nano media-decider usage (billed alongside the reply), and the reaction
    // GIF/meme it picked — fetched BEFORE the reply so the model knows what's
    // attached and the client can show it first (like texting a gif, then typing).
    let decideUsage: ModelUsage | null = null;
    // Usage from the look-&-pick selector (nano), billed alongside the decider.
    let pickUsage: ModelUsage | null = null;
    // Usage from the web-search router (nano), and the flat USD cost of the Tavily
    // call when one ran — both billed alongside the reply (see chargeForUsage).
    let webRouterUsage: ModelUsage | null = null;
    let searchCostUsd = 0;
    let pendingGif: MessageGif | null = null;
    let pendingMeme: MessageImage | null = null;
    // GIF frames decoded for the decider; reused by assembleContext so the GIF
    // is only fetched/decoded once per turn.
    let deciderGifFrames: ExtractedGifFrames | undefined;
    const klipyApiKey = KLIPY_APP_KEY.value();
    // Media off (user toggle) skips the decider entirely — no decider call, no
    // reaction GIF/meme, no attachedMedia note — so the reply is purely text.
    const mediaEnabled = klipyApiKey.length > 0 && respondWithMedia;
    try {
      internalModel = chooseModel(entitlement.plan);

      // Read the user's memory ONCE for the whole turn and render both views:
      // the taste-only `media` view nudges the decider toward more personal
      // reactions; the full `reply` view is handed to the Agent below so it
      // isn't read twice. Paid-gated + never throws — free users get empties.
      // The persona resolves in parallel (also once for the whole turn): the
      // media decider needs its mediaDeciderKey/mediaNotes BEFORE the reply,
      // and the Agent reuses the same resolution for the system prompt.
      const [memViews, personaForStream] = await Promise.all([
        memoryService.getMemoryViews(uid, entitlement.plan),
        resolvePersonaForStream(personaId, uid),
      ]);

      // Decider pre-step (mini — vision-first since 2026-06-10): decide whether
      // this turn warrants a reaction GIF/meme and pick the search term, then
      // fetch it. The reply model gets a note about what's attached (cohesion)
      // and never makes a tool round-trip.
      let attachedMedia:
        | { kind: "gif" | "meme"; description: string }
        | undefined;
      // Loaded once for both pre-steps' context (media decider + web router).
      const priorMessages = await loadRecentMessages(conversationId, 12);
      const deciderContext = buildDeciderContext(priorMessages);

      // Web-search router (nano) + Tavily fetch, kicked off here WITHOUT awaiting
      // so it runs concurrently with the media decider/fetch/pick below and hides
      // under that latency. Awaited just before context assembly. Never throws;
      // no-ops when the message is empty or the Tavily key is unset.
      const webContextPromise = gatherWebContext({
        openaiApiKey: OPENAI_API_KEY.value(),
        tavilyApiKey: TAVILY_API_KEY.value(),
        message: userText,
        history: deciderContext.history,
      });

      if (mediaEnabled) {
        const { history, recentReactions, recentMediaIds } = deciderContext;
        // Hard never-echo backstop: the fetch tools drop these Klipy ids from
        // the result pool so the exact same asset can never be re-sent. Covers
        // the user's CURRENT attachments (the main echo source) plus everything
        // recently seen in history (their past sends + the bot's reactions).
        const excludeIds = new Set<string>(recentMediaIds);
        for (const g of gifs) {
          if (g.id) excludeIds.add(g.id);
          if (g.gifId) excludeIds.add(g.gifId);
        }
        for (const i of images) {
          if (i.source === "klipy") {
            if (i.id) excludeIds.add(i.id);
            if (i.memeId) excludeIds.add(i.memeId);
          }
        }
        // Append the Klipy "meme name" hint (when present) so the decider can
        // recognize a named reference the user sent, not just react to pixels.
        const deciderHint = buildDeciderAttachmentHint(attachmentTitles);
        const currentForDecider =
          (userText ||
            (images.length > 0
              ? "[user sent an image]"
              : gifs.length > 0
                ? "[user sent a GIF]"
                : "")) + (deciderHint ? `\n\n${deciderHint}` : "");
        // Decode the GIF once here and reuse it for both the decider (so it can
        // see what was sent) and assembleContext (so the reply model sees it too)
        // — avoids fetching/decoding the same GIF twice.
        const currentGifFrames = currentGif
          ? await extractGifFrames(currentGif)
          : undefined;
        const deciderSystemPrompt = await buildMediaDeciderPrompt(
          levelOfRot,
          personaForStream.personaPrompt,
        );
        const { decision, usage } = await decideMedia({
          apiKey: OPENAI_API_KEY.value(),
          systemPrompt: deciderSystemPrompt,
          // Taste-only memory so the decider can pick a more on-point reaction.
          memoryBlock: memViews.media,
          history,
          currentMessage: currentForDecider,
          recentReactions,
          // Hand the decider the actual pixels of the current turn's attachments
          // so its reaction matches what the user sent.
          imageUrls: [...currentImageUrls, ...(currentGifFrames?.frames ?? [])],
        });
        decideUsage = usage;
        deciderGifFrames = currentGifFrames;

        if (decision.type === "gif" || decision.type === "meme") {
          // Look-&-pick on BROAD queries only (randomness > 2): a cheap nano
          // read of the real result titles, choosing the best fit instead of a
          // blind random pick. Exact references (randomness 1-2) skip it and
          // keep the top hit — no extra call, no drift off the canonical match.
          const selectIndex =
            decision.randomnessFactor > 2
              ? (titles: string[]) =>
                  pickBestMediaIndex({
                    apiKey: OPENAI_API_KEY.value(),
                    message: currentForDecider,
                    titles,
                  })
              : undefined;
          const klipyDeps = {
            apiKey: klipyApiKey,
            customerId: uid,
            excludeIds,
            selectIndex,
          };
          const rawArgs = JSON.stringify({
            query: decision.query,
            randomness_factor: decision.randomnessFactor,
          });
          let klipyEmptyResult = false;
          try {
            if (decision.type === "gif") {
              const r = await runGetGif(rawArgs, klipyDeps);
              if (r.selectUsage) pickUsage = r.selectUsage;
              if (r.gif) {
                pendingGif = r.gif;
                attachedMedia = {
                  kind: "gif",
                  description: r.title ?? decision.query,
                };
              } else {
                klipyEmptyResult = true;
              }
            } else {
              const r = await runGetMeme(rawArgs, klipyDeps);
              if (r.selectUsage) pickUsage = r.selectUsage;
              if (r.meme) {
                pendingMeme = r.meme;
                attachedMedia = {
                  kind: "meme",
                  description: r.title ?? decision.query,
                };
              } else {
                klipyEmptyResult = true;
              }
            }
          } catch (err) {
            logger.warn(
              "[streamAgentAnswer] media fetch failed; replying text-only",
              { conversationId, err },
            );
            klipyEmptyResult = true;
          }
          if (klipyEmptyResult) {
            logger.info("[streamAgentAnswer] klipy empty result", {
              query: decision.query,
              decisionType: decision.type,
              doNotRepeatCollision: recentReactions.includes(decision.query),
            });
          }
        }
      }

      // Persona + (paid-gated) long-term memory + conversation history, composed
      // behind the Agent so this orchestrator carries no context-assembly or
      // memory logic itself. Memory adds no model call and runs in parallel with
      // persona resolution, so it doesn't affect turn latency.
      const agent = new Agent({
        uid,
        plan: entitlement.plan,
        personaId,
        // Resolved once above (it fed the media decider) — the Agent reuses it
        // instead of reading the persona docs again.
        resolvedPersona: personaForStream,
        levelOfRot,
        respondWithEmojis,
        memory: memoryService,
      });
      // Join the concurrent web-search pre-step before assembling context. Its
      // router usage + flat search cost are billed in chargeForUsage; the fetched
      // context (when any) is injected as a fresh-tail system note.
      const web = await webContextPromise;
      webRouterUsage = web.routerUsage;
      searchCostUsd = web.searchCostUsd;
      const replyContext = await agent.buildReplyContext({
        conversationId,
        currentUserMessage: userText,
        currentImageUrls,
        currentGif,
        currentGifFrames: deciderGifFrames,
        currentAttachmentTitles: attachmentTitles,
        attachedMedia,
        webContext: web.webContext ?? undefined,
        userAlias: entitlement.alias,
        userLanguage: language,
        // Already read above for the decider — hand the reply view to the Agent
        // so it doesn't read the memory state a second time.
        memoryBlock: memViews.reply,
      });
      resolvedPersona = replyContext.persona;
      assembleResult = replyContext.assembled;
    } catch (err) {
      if (err instanceof PersonaAccessError) {
        // The turn referenced a persona the caller doesn't own. Generic by
        // design — no signal about whether it exists or who owns it. Logged at
        // warn (not error) since it's client misuse, not a server fault.
        logger.warn("[streamAgentAnswer] persona access denied", {
          conversationId,
          uid,
          personaId,
        });
        res.status(403).json({ code: "forbidden" });
        return;
      }
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
    // The reaction GIF/meme chosen by the media decider before streaming, if any.
    // Emitted to the client first (media-then-text), then persisted on the agent
    // message at finalize. At most one is set.
    let agentMeme: MessageImage | null = pendingMeme;
    let agentGif: MessageGif | null = pendingGif;
    const abortController = new AbortController();

    // Charge the turn's real cost once the stream's final usage is known. Sums
    // both calls that ran: the media decider (mini, always) + the mini reply —
    // each usage carries its own model id, so the ledger prices the decider at
    // mini rates since the 2026-06-10 nano→mini upgrade. If neither produced
    // usage (e.g. the client aborted before any output and the decider was
    // skipped), the turn is free.
    const chargeForUsage = async (reason: string) => {
      const usages: ModelUsage[] = [];
      if (
        decideUsage &&
        (decideUsage.inputTokens > 0 || decideUsage.outputTokens > 0)
      ) {
        usages.push(decideUsage);
      }
      // The look-&-pick selector (nano), when it ran on a broad query.
      if (
        pickUsage &&
        (pickUsage.inputTokens > 0 || pickUsage.outputTokens > 0)
      ) {
        usages.push(pickUsage);
      }
      // The web-search router (nano), when it actually hit the API.
      if (
        webRouterUsage &&
        (webRouterUsage.inputTokens > 0 || webRouterUsage.outputTokens > 0)
      ) {
        usages.push(webRouterUsage);
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

      // Early-rollout calibration: compare our flat image-token estimate to the
      // model's actual prompt tokens so we can tune IMAGE_TOKENS_LOW per model.
      // No image URLs are logged.
      if (lastUsage && images.length > 0) {
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
        const tokenCostUsd = usages.reduce(
          (sum, u) => sum + calculateCostUsd(u.model, u),
          0,
        );
        // Fold the flat Tavily search cost into the turn's total before credits.
        const costUsd = tokenCostUsd + searchCostUsd;
        const credits = calculateCredits(costUsd);
        await chargeCredits(uid, entitlement.plan, {
          conversationId: conversationId!,
          messageId: agentMessageId,
          kind: "turn",
          usages,
          costUsd,
          credits,
          searchCostUsd,
        });
      } catch (err) {
        logger.error("[streamAgentAnswer] charge failed", {
          userKey: logKey(uid),
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
        // Denormalized so turn replay can rebuild the same prefs (only the OFF
        // state is actually written — see appendMessage).
        respondWithEmojis,
        respondWithMedia,
        // Denormalize the owner's plan onto the conversation so the background
        // summarizer can size its verbatim window to this plan's token budget.
        plan: entitlement.plan,
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
              // User personas have no preset avatarKey (they use an uploaded
              // avatarUrl); keep this stored field a plain string for history.
              avatarKey: resolvedPersona.publicConfig.avatarKey ?? "",
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

      // Media-first, like texting: surface the chosen GIF/meme before the reply
      // streams so it lands above the text bubble. At most one is set.
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
        // No tools: the reaction GIF/meme was already decided + fetched by the
        // decider pre-step, so the reply model just writes text in a single call.
        // No sampling overrides: gpt-5.x reasoning models reject a non-default
        // top_p, and the rot intensity already lives in the persona few-shots —
        // not in a sampling knob. Keeping the request param-free also keeps it
        // fully cacheable.
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

      // Post-hoc output lint: the no-eval behavior dashboard. Advisory only —
      // the reply already streamed; findings land in Cloud Logging as warns
      // (filter "[outputLint]", group by rule) so prompt rollouts are
      // observable per rot level within a day.
      try {
        const lintFindings = lintAgentReply(fullText, {
          rotLevel: levelOfRot,
          emojisEnabled: respondWithEmojis,
        });
        if (lintFindings.length > 0) {
          logger.warn("[outputLint] reply flagged", {
            conversationId,
            agentMessageId,
            rotLevel: levelOfRot,
            emojisEnabled: respondWithEmojis,
            replyChars: fullText.length,
            findings: lintFindings,
          });
        }
      } catch (err) {
        logger.error("[outputLint] linter threw", { err });
      }

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
