import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { streamAgent } from "./agent/streamAgent";
import type { AgentUsage } from "./agent/types";
import { chargeCredits, evaluateQuota } from "./billing/ledger";
import { calculateCostUsd, calculateCredits } from "./billing/credits";
import { resolveModelId } from "./billing/models";
import { checkIpRateLimit, extractClientIp } from "./billing/rateLimit";
import { chooseModel } from "./billing/router";
import { assembleContext } from "./context/assemble";
import {
  appendMessage,
  assertConversationOwner,
  createConversation,
  finalizeAgentMessage,
  markAgentMessageErrored,
} from "./conversations/repository";
import { loadEntitlement } from "./entitlement/loadEntitlement";
import { buildSystemPromptForStream } from "./personas/prompts";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().min(1).optional(),
  clientMessageId: z.string().trim().min(1).max(128).optional(),
  personaId: z.string().trim().min(1).max(128).optional(),
});

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

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
    secrets: [OPENAI_API_KEY],
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

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_request" });
      return;
    }

    const userText = parsed.data.message;
    const personaId = parsed.data.personaId;
    const clientMessageId = parsed.data.clientMessageId;

    // ---------- resolve conversation ----------
    let conversationId = parsed.data.conversationId;
    const newConversation = !conversationId;
    try {
      if (conversationId) {
        await assertConversationOwner(conversationId, uid);
      } else {
        const created = await createConversation(uid, userText);
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

    // ---------- routing + context ----------
    let internalModel;
    let assembleResult;
    let resolvedPersona:
      | Awaited<ReturnType<typeof buildSystemPromptForStream>>["persona"]
      | null = null;
    try {
      internalModel = chooseModel(entitlement.plan);
      const promptResult = await buildSystemPromptForStream(personaId);
      resolvedPersona = promptResult.persona;
      assembleResult = await assembleContext({
        conversationId,
        plan: entitlement.plan,
        currentUserMessage: userText,
        systemPrompt: promptResult.systemPrompt,
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
    const abortController = new AbortController();

    // Charge the turn's real cost once the stream's final usage is known.
    // There is nothing to reserve or release: if no usage ever arrived (e.g.
    // the client aborted before any output), the turn is free.
    const chargeForUsage = async (reason: string) => {
      if (!lastUsage) return;
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

      try {
        await finalizeAgentMessage(conversationId, agentMessageId, fullText);
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
