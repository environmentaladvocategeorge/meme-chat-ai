import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import OpenAI from "openai";
import { UTILITY_MODEL } from "../billing/models";
import { planCompaction } from "./compaction";
import { countTokens } from "./tokens";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// Cap on the transcript we hand the utility model in one compaction run. We only
// ever summarize the newly-aged-out tail (recursive summarization), so this is
// a generous ceiling, not the common case.
const MAX_TRANSCRIPT_CHARS = 12_000;

type SummarizableDoc = {
  id: string;
  role: "user" | "agent";
  text: string;
  tokens: number;
  // Short stand-in for an attachment-only turn so the summary still records
  // "user sent a meme/gif here" without us shipping the image to the model.
  attachmentNote: string | null;
};

// Background summarizer. Fires on every message write inside a conversation and
// short-circuits via planCompaction unless enough turns have aged out of the
// verbatim window. Cost is absorbed by us (never billed to the user), so it runs
// on the cheap UTILITY_MODEL (gpt-5-nano) and only over the newly-aged-out tail.
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

    // Only COMPLETE messages participate. Streaming placeholders (empty text)
    // and errored turns are excluded so the summary boundary can never land on a
    // doc whose id is about to be reused with different content, and so the
    // boundary id we persist is stable for assembly to match against.
    const docs: SummarizableDoc[] = [];
    for (const doc of allSnap.docs) {
      const d = doc.data() as {
        role?: string;
        text?: string;
        status?: string;
        images?: unknown[];
        gifs?: unknown[];
      };
      if (d.status !== "complete") continue;
      if (d.role !== "user" && d.role !== "agent") continue;

      const text = typeof d.text === "string" ? d.text : "";
      const hasImages = Array.isArray(d.images) && d.images.length > 0;
      const hasGifs = Array.isArray(d.gifs) && d.gifs.length > 0;

      let attachmentNote: string | null = null;
      if (hasImages) attachmentNote = "[sent a meme image]";
      else if (hasGifs) attachmentNote = "[sent an animated GIF]";

      // Skip empty turns that carry nothing at all (mirrors assembly's filter).
      if (text.length === 0 && !attachmentNote) continue;

      docs.push({
        id: doc.id,
        role: d.role,
        text,
        tokens: countTokens(text),
        attachmentNote,
      });
    }

    const conversationSnap = await conversationRef.get();
    const data = conversationSnap.data() as
      | { summary?: string; summaryUpToMessageId?: string | null }
      | undefined;

    const plan = planCompaction({
      messageIds: docs.map((d) => d.id),
      messageTokens: docs.map((d) => d.tokens),
      lastSummarizedId: data?.summaryUpToMessageId ?? null,
    });
    if (!plan.summarize) return;

    // Recursive summarization: fold ONLY the newly-aged-out turns into the
    // existing summary. The prior summary is the running memory of everything
    // older; we never re-read the whole transcript.
    const transcriptLines: string[] = [];
    for (let i = plan.fromIndex; i <= plan.toIndex; i++) {
      const d = docs[i];
      const speaker = d.role === "agent" ? "Assistant" : "User";
      const body =
        d.text.length > 0 && d.attachmentNote
          ? `${d.text}\n${d.attachmentNote}`
          : d.text.length > 0
            ? d.text
            : d.attachmentNote!;
      transcriptLines.push(`${speaker}: ${body}`);
    }
    const newTurns = transcriptLines.join("\n").slice(0, MAX_TRANSCRIPT_CHARS);

    const priorSummary = data?.summary?.trim();
    const userContent = priorSummary
      ? `Existing summary of the conversation so far:\n${priorSummary}\n\n` +
        `New messages to fold into it (oldest first):\n${newTurns}`
      : newTurns;

    try {
      const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
      const completion = await client.chat.completions.create({
        model: UTILITY_MODEL,
        // gpt-5.x requires `max_completion_tokens`; `max_tokens` 400s.
        max_completion_tokens: 500,
        messages: [
          {
            role: "system",
            content:
              "You maintain a running summary of a chat conversation. Merge the " +
              "existing summary (if any) with the new messages into ONE updated " +
              "summary of 6-12 sentences. Preserve names, decisions made, ongoing " +
              "goals, unresolved questions, and the user's stated preferences. Keep " +
              "facts that later turns may rely on; drop greetings and filler. Write " +
              "it as plain notes, not a transcript.",
          },
          { role: "user", content: userContent },
        ],
      });
      const summary = completion.choices[0]?.message?.content?.trim() ?? "";
      if (!summary) return;

      await conversationRef.set(
        {
          summary,
          summarized: true,
          summaryUpToMessageId: plan.boundaryId,
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
