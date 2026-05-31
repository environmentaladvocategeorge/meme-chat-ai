import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import OpenAI from "openai";
import { UTILITY_MODEL } from "../billing/models";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// An in-flight title attempt holds a claim for this long. A claim older than
// this is treated as dead (the attempt crashed or timed out) so a later message
// write can retry. Must exceed the function timeout so we never preempt a live
// attempt mid-flight.
const TITLE_CLAIM_TTL_MS = 60_000;

// We title from the opening EXCHANGE (the first user turn + the bot's first
// reply), not just the user's opener. The bot already "read" any meme/GIF the
// user sent and reacted to it in text, so its reply is our cheap, vision-free
// window into what an image-only opener was actually about. Cap each side so a
// long reply can't blow up the title model's input.
const MAX_OPENER_CHARS = 500;
const MAX_REPLY_CHARS = 1500;

const TITLE_SYSTEM_PROMPT =
  "You write the title for a chat thread inside Brainrot Bot, a mobile AI chat " +
  "app where people talk to a chronically-online, meme-fluent AI friend. The bot " +
  "jokes around and uses internet slang but still gives real, correct answers, and " +
  "people send it everything: homework help, life advice, hot takes, venting, memes " +
  "and GIFs, random shower thoughts. The title shows up in the user's conversation " +
  "list, so it should sound like the bot named it and capture the VIBE of the chat, " +
  "not just repeat what was said.\n\n" +
  "You get the opening exchange: the user's first message (sometimes just a meme or " +
  "GIF, shown as a note like [sent a meme image]) and the bot's first reply. Use " +
  "BOTH to work out what the chat is really about, especially when the user only " +
  "sent an image and the bot's reply is your only clue to what was in it.\n\n" +
  "Write ONE short title, 2-5 words, that is funny and meme-y but still makes it " +
  "obvious what the chat is about. Lean into the same brainrot/internet slang the " +
  "bot uses when it fits naturally (words like villain arc, side quest, lore, boss " +
  "fight, main character energy, glow up, -maxxing, rizz, grindset, cooked, aura, " +
  "W), but don't force it or stack more than one. Add exactly ONE emoji that fits " +
  "the topic, at the start or the end. Use Title Case. No em dashes. Do NOT copy the " +
  "message word-for-word, riff on it. No quotes, no hashtags, no trailing " +
  "punctuation. If there's nothing to go on, return a short playful generic title " +
  "with an emoji.\n\n" +
  "Examples:\n" +
  "Opener is a meme image; the bot's reply jokes it's the distracted-boyfriend meme " +
  "about ignoring homework -> Homework Avoidance Arc 💀\n" +
  'First message: "how do i get over a breakup" -> Breakup Recovery Arc 🥀\n' +
  'First message: "whats a good high protein breakfast" -> Protein Maxxing Breakfast 🍳\n' +
  'First message: "help me write a cover letter" -> Cover Letter Rizz ✍️\n' +
  'First message: "explain quantum computing like im 5" -> Quantum Brainrot Lore ⚛️\n' +
  'First message: "i think my cat secretly hates me" -> Cat Villain Arc 😾';

function cleanTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    // Drop a dangling high surrogate if the slice split an emoji in half.
    .replace(/[\uD800-\uDBFF]$/, "")
    .trim();
}

// Short stand-in for an attachment-only turn so the title model gets the gist
// without us ever shipping the image to it (mirrors the summarizer's pattern).
function attachmentNoteFor(d: {
  images?: unknown[];
  gifs?: unknown[];
}): string | null {
  if (Array.isArray(d.images) && d.images.length > 0) return "[sent a meme image]";
  if (Array.isArray(d.gifs) && d.gifs.length > 0) return "[sent an animated GIF]";
  return null;
}

// Render one turn as "<text>" / "[attachment note]" / both, capped in length.
function turnBody(
  text: string,
  attachmentNote: string | null,
  cap: number,
): string {
  const trimmed = text.trim().slice(0, cap);
  if (trimmed.length > 0 && attachmentNote) return `${trimmed}\n${attachmentNote}`;
  if (trimmed.length > 0) return trimmed;
  return attachmentNote ?? "";
}

type Turn = { text: string; attachmentNote: string | null };

// Fires on every message write but short-circuits immediately once the title is
// set. We wait for the FIRST complete agent reply so an image-only opener still
// gets a real title (the reply is what tells us what the meme was). Until then,
// the seeded fallback title stays and the next write re-triggers us.
export const generateConversationTitle = onDocumentWritten(
  {
    document: "conversations/{cid}/messages/{mid}",
    secrets: [OPENAI_API_KEY],
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (event) => {
    const cid = event.params.cid;
    const db = getFirestore();
    const conversationRef = db.doc(`conversations/${cid}`);

    // Cheap guard first: one doc read, then bail on already-titled conversations
    // before we ever scan the messages subcollection.
    const conversationSnap = await conversationRef.get();
    const conv = conversationSnap.data() as
      | { titleGenerated?: boolean }
      | undefined;
    if (!conv || conv.titleGenerated) return;

    const messagesSnap = await conversationRef
      .collection("messages")
      .orderBy("createdAt", "asc")
      .get();

    let firstUser: Turn | null = null;
    let firstAgent: Turn | null = null;
    for (const doc of messagesSnap.docs) {
      const d = doc.data() as {
        role?: string;
        text?: string;
        status?: string;
        images?: unknown[];
        gifs?: unknown[];
      };
      // Only COMPLETE turns count; streaming placeholders carry no usable text.
      if (d.status !== "complete") continue;
      const text = typeof d.text === "string" ? d.text : "";
      const note = attachmentNoteFor(d);
      if (text.length === 0 && !note) continue;

      if (d.role === "user" && !firstUser) {
        firstUser = { text, attachmentNote: note };
      } else if (d.role === "agent" && !firstAgent) {
        firstAgent = { text, attachmentNote: note };
      }
      if (firstUser && firstAgent) break;
    }

    // Need both halves of the exchange before titling.
    if (!firstUser || !firstAgent) return;

    const userBody = turnBody(
      firstUser.text,
      firstUser.attachmentNote,
      MAX_OPENER_CHARS,
    );
    const agentBody = turnBody(
      firstAgent.text,
      firstAgent.attachmentNote,
      MAX_REPLY_CHARS,
    );
    if (!userBody && !agentBody) return;

    const exchange = `User: ${userBody}\nBrainrot Bot: ${agentBody}`;

    // Atomic claim. The title model call below takes a second or two, and the
    // titleGenerated flag isn't written until it returns, so a fast follow-up
    // message (or any concurrent message write) could fire a second invocation
    // that sees the same untitled exchange and calls the model again. The
    // transaction lets exactly one invocation claim the work; the rest bail. A
    // stale claim (crashed/timed-out attempt) ages out so titling can retry.
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(conversationRef);
      const d = snap.data() as
        | { titleGenerated?: boolean; titleClaimedAt?: Timestamp }
        | undefined;
      if (!d || d.titleGenerated) return false;
      const claim = d.titleClaimedAt;
      const claimIsLive =
        claim instanceof Timestamp &&
        Date.now() - claim.toMillis() < TITLE_CLAIM_TTL_MS;
      if (claimIsLive) return false;
      tx.update(conversationRef, { titleClaimedAt: Timestamp.now() });
      return true;
    });
    if (!claimed) return;

    try {
      const client = new OpenAI({
        apiKey: OPENAI_API_KEY.value(),
      });

      const completion = await client.chat.completions.create({
        model: UTILITY_MODEL,
        // gpt-5-nano is a reasoning model: max_completion_tokens is the TOTAL
        // budget (reasoning + visible output). The previous 80-token cap let the
        // reasoning pass eat the whole budget, leaving content empty
        // (finish_reason "length"). Keep low effort but give real headroom so
        // the short title actually gets emitted.
        reasoning_effort: "low",
        max_completion_tokens: 1000,
        messages: [
          {
            role: "system",
            content: TITLE_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: exchange,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      const title = cleanTitle(raw);

      logger.info("[generateConversationTitle] OpenAI response", {
        cid,
        finishReason: completion.choices[0]?.finish_reason,
        raw,
        title,
        usage: completion.usage,
      });

      if (!title) {
        logger.warn("[generateConversationTitle] empty title generated", {
          cid,
          finishReason: completion.choices[0]?.finish_reason,
          usage: completion.usage,
        });
        return;
      }

      await conversationRef.set(
        {
          title,
          titleGenerated: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      logger.error("[generateConversationTitle] failed", {
        cid,
        err,
      });
    }
  },
);
