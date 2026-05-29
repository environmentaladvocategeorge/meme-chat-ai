import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import OpenAI from "openai";
import { UTILITY_MODEL } from "../billing/models";
import { countTokens } from "./tokens";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// Compaction trigger is a turns+tokens combination: only summarize once a
// conversation is genuinely long (MESSAGES_BEFORE_SUMMARIZE total), then fire
// when the unsummarized tail has grown either by enough turns OR enough tokens
// — whichever comes first. Token-heavy turns (long pastes) trip it early;
// many short turns trip it on count.
const MESSAGES_BEFORE_SUMMARIZE = 12;
const UNSUMMARIZED_MSG_THRESHOLD = 6;
const UNSUMMARIZED_TOKEN_THRESHOLD = 1500;

// Background summarizer. Fires on every message write inside a conversation and
// short-circuits unless the trigger above is met. Cost is absorbed by us (never
// billed to the user), so it runs on the cheap UTILITY_MODEL (gpt-5-nano).
export const summarizeConversation = onDocumentWritten(
  {
    document: "conversations/{cid}/messages/{mid}",
    secrets: [OPENAI_API_KEY],
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const cid = event.params.cid;
    const db = getFirestore();
    const conversationRef = db.doc(`conversations/${cid}`);
    const messagesRef = conversationRef.collection("messages");

    const allSnap = await messagesRef.orderBy("createdAt", "asc").get();
    const total = allSnap.size;
    if (total <= MESSAGES_BEFORE_SUMMARIZE) return;

    const conversationSnap = await conversationRef.get();
    const data = conversationSnap.data() as
      | { summary?: string; summaryUpToMessageId?: string | null }
      | undefined;

    const lastSummarizedId = data?.summaryUpToMessageId ?? null;
    const cutoffIdx = lastSummarizedId
      ? allSnap.docs.findIndex((d) => d.id === lastSummarizedId)
      : -1;
    const unsummarized = allSnap.docs.slice(cutoffIdx + 1);

    // turns + tokens: summarize once the tail crosses either threshold.
    const unsummarizedTokens = unsummarized.reduce((sum, d) => {
      const text = (d.data() as { text?: string }).text;
      return sum + (typeof text === "string" ? countTokens(text) : 0);
    }, 0);
    if (
      unsummarized.length < UNSUMMARIZED_MSG_THRESHOLD &&
      unsummarizedTokens < UNSUMMARIZED_TOKEN_THRESHOLD
    ) {
      return;
    }

    // Build a compact transcript from EVERY message up to and including the
    // tail we're about to absorb, plus the existing summary as preamble.
    const transcriptLines: string[] = [];
    if (data?.summary) {
      transcriptLines.push(`Previous summary:\n${data.summary}\n`);
    }
    for (const doc of allSnap.docs) {
      const d = doc.data() as { role?: string; text?: string; status?: string };
      if (d.status !== "complete") continue;
      if (typeof d.text !== "string" || d.text.length === 0) continue;
      const speaker = d.role === "agent" ? "Assistant" : "User";
      transcriptLines.push(`${speaker}: ${d.text}`);
    }
    const transcript = transcriptLines.join("\n").slice(0, 12_000);

    const newestId = allSnap.docs[allSnap.docs.length - 1]?.id ?? null;
    if (!newestId) return;

    try {
      const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
      const completion = await client.chat.completions.create({
        model: UTILITY_MODEL,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "Summarize the conversation in 6-10 sentences. Preserve names, decisions, " +
              "ongoing goals, open questions, and the user's preferences. Skip filler.",
          },
          { role: "user", content: transcript },
        ],
      });
      const summary = completion.choices[0]?.message?.content?.trim() ?? "";
      if (!summary) return;

      await conversationRef.set(
        {
          summary,
          summarized: true,
          summaryUpToMessageId: newestId,
          summaryTokens: countTokens(summary),
          summaryUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      logger.error("[summarizeConversation] failed", { cid, err });
    }
  },
);
