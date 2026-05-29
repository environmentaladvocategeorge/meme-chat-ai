import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import OpenAI from "openai";
import { UTILITY_MODEL } from "../billing/models";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// Me-Me is a playful meme-flavored chat companion. Give the title model just
// enough product context to land titles that are punchy and a little meme-y,
// but still genuinely describe what the chat is about.
const TITLE_SYSTEM_PROMPT =
  "You name chat conversations for Me-Me, a playful, meme-loving AI chat app. " +
  "Given the user's first message, write ONE short title (3-6 words) that is " +
  "fun and a little meme-y but still clearly describes the topic. " +
  "Title Case. No quotes, no emojis, no trailing punctuation. " +
  "If the message is empty or nonsense, return a generic playful title.";

// Generates a fixed, meme-flavored conversation title once, when the
// conversation is created. Uses only the first user message + app context.
// Runs on the cheap UTILITY_MODEL (gpt-5-nano); cost is absorbed by us, never
// billed to the user.
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
    if (data.titleGenerated) return; // idempotent guard

    const firstMessage = (data.firstUserMessage ?? "").trim();
    if (!firstMessage) return;

    try {
      const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
      const completion = await client.chat.completions.create({
        model: UTILITY_MODEL,
        // gpt-5.x requires `max_completion_tokens`; `max_tokens` 400s.
        max_completion_tokens: 24,
        messages: [
          { role: "system", content: TITLE_SYSTEM_PROMPT },
          { role: "user", content: firstMessage },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? "";
      // Strip stray wrapping quotes / trailing punctuation, cap length.
      const title = raw
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/[.!?]+$/g, "")
        .slice(0, 60)
        .trim();
      if (!title) return;

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
