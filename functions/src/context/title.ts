import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import OpenAI from "openai";
import { UTILITY_MODEL } from "../billing/models";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

const TITLE_SYSTEM_PROMPT =
  "You name chat conversations for Me-Me, a playful, meme-loving AI chat app. " +
  "Given the user's first message, write ONE short title (3-6 words) that is " +
  "fun and a little meme-y but still clearly describes the topic. " +
  "Title Case. No quotes, no emojis, no trailing punctuation. " +
  "If the message is empty or nonsense, return a generic playful title.";

function cleanTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .trim();
}

export const generateConversationTitle = onDocumentCreated(
  {
    document: "conversations/{cid}",
    secrets: [OPENAI_API_KEY],
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data() as {
      firstUserMessage?: string;
      titleGenerated?: boolean;
    };

    if (data.titleGenerated) return;

    const firstMessage = (data.firstUserMessage ?? "").trim();
    if (!firstMessage) return;

    try {
      const client = new OpenAI({
        apiKey: OPENAI_API_KEY.value(),
      });

      const completion = await client.chat.completions.create({
        model: UTILITY_MODEL,
        reasoning_effort: "low",
        max_completion_tokens: 80,
        messages: [
          {
            role: "system",
            content: TITLE_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: firstMessage,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      const title = cleanTitle(raw);

      logger.info("[generateConversationTitle] OpenAI response", {
        cid: event.params.cid,
        finishReason: completion.choices[0]?.finish_reason,
        raw,
        title,
        usage: completion.usage,
      });

      if (!title) {
        logger.warn("[generateConversationTitle] empty title generated", {
          cid: event.params.cid,
          finishReason: completion.choices[0]?.finish_reason,
          usage: completion.usage,
        });
        return;
      }

      await snap.ref.set(
        {
          title,
          titleGenerated: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      logger.error("[generateConversationTitle] failed", {
        cid: event.params.cid,
        err,
      });
    }
  },
);
