import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import OpenAI from "openai";
import { resolveModelId } from "../billing/models";
import { countTokens } from "./tokens";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

const MESSAGES_BEFORE_SUMMARIZE = 12;
const UNSUMMARIZED_THRESHOLD = 6;

// Background summarizer. Fires on every message write inside a conversation,
// short-circuits unless the unsummarized tail has grown past
// UNSUMMARIZED_THRESHOLD AND total messages > MESSAGES_BEFORE_SUMMARIZE.
// Uses the cheapest model — summary quality is a margin lever, not UX.
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
    if (unsummarized.length < UNSUMMARIZED_THRESHOLD) return;

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
        model: resolveModelId("nano"),
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
