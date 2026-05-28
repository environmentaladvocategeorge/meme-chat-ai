import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { streamAgent } from "./agent/streamAgent";
import type { ChatMessage } from "./agent/types";
import {
  appendMessage,
  assertConversationOwner,
  createConversation,
  finalizeAgentMessage,
  loadRecentMessages,
  markAgentMessageErrored,
} from "./conversations/repository";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().min(1).optional(),
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

    let conversationId = parsed.data.conversationId;
    const userText = parsed.data.message;
    let agentMessageId: string | null = null;
    let finalized = false;
    let clientClosed = false;
    const abortController = new AbortController();

    req.on("close", () => {
      if (!finalized) {
        clientClosed = true;
        abortController.abort();
      }
    });

    try {
      let priorMessages: ChatMessage[] = [];

      if (conversationId) {
        try {
          await assertConversationOwner(conversationId, uid);
        } catch {
          throw new Error("conversation-not-found");
        }
        priorMessages = await loadRecentMessages(conversationId);
      } else {
        const created = await createConversation(uid, userText);
        conversationId = created.conversationId;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      await appendMessage(conversationId, {
        role: "user",
        text: userText,
        status: "complete",
      });

      if (!parsed.data.conversationId) {
        writeSse(res, "conversation", { id: conversationId });
      }

      const agentMessage = await appendMessage(conversationId, {
        role: "agent",
        text: "",
        status: "streaming",
      });
      agentMessageId = agentMessage.messageId;

      const messages: ChatMessage[] = [
        ...priorMessages,
        { role: "user", text: userText },
      ];
      let fullText = "";

      for await (const delta of streamAgent({
        messages,
        apiKey: OPENAI_API_KEY.value(),
        signal: abortController.signal,
      })) {
        if (clientClosed) {
          await markErroredSafely(conversationId, agentMessageId);
          finalized = true;
          return;
        }

        if (delta.type === "delta") {
          fullText += delta.text;
          writeSse(res, "delta", { text: delta.text });
          continue;
        }

        if (delta.type === "error") {
          logger.error("[streamAgentAnswer] agent stream failed", {
            message: delta.message,
          });
          writeSse(res, "error", { code: "agent_error" });
          finalized = true;
          res.end();
          await markErroredSafely(conversationId, agentMessageId);
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
        return;
      }

      const status =
        err instanceof Error && err.message === "conversation-not-found"
          ? 404
          : 500;
      res.status(status).json({ code: status === 404 ? "not_found" : "internal" });
    }
  },
);
