import { getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { ChatMessage } from "../agent/types";
import { PLANS, type PlanId } from "../billing/plans";
import {
  extractGifFrames,
  type ExtractedGifFrames,
} from "../gifs/extractFrames";
import type { MessageGif } from "../messages/messageGif";
import type { MessageImage } from "../messages/messageImage";
import { RECENT_WINDOW } from "./compaction";
import { countMessagesTokens } from "./tokens";

const DEFAULT_SYSTEM_PROMPT =
  "You are Brainrot Bot, a friendly and concise chat assistant. Reply in the user's language. Keep answers focused; offer detail only when the user asks for it.";

// Chat Completions multimodal content parts. Assistant/system content stays a
// plain string; only the current user turn may become an array of parts.
export type OpenAITextPart = { type: "text"; text: string };
export type OpenAIImagePart = {
  type: "image_url";
  image_url: { url: string; detail: "low" };
};
export type OpenAIContentPart = OpenAITextPart | OpenAIImagePart;

export type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  content: string | OpenAIContentPart[];
};

export type AssembledContext = {
  messages: OpenAIMessage[];
  inputTokens: number;
  summaryUsed: boolean;
  recentMessageCount: number;
};

export type AssembleArgs = {
  systemPrompt?: string;
  // User's display alias injected as a second system message so the main
  // system prompt stays cacheable (identical prefix for all users).
  userAlias?: string | null;
  summary?: string | null;
  recent: ChatMessage[]; // ordered oldest → newest, already filtered to status: complete
  currentText: string;
  // Model-ready image URLs for the current turn (resolved by resolveImageInputs:
  // Klipy CDN previewUrls and/or base64 data URLs for ingested uploads).
  currentImageUrls?: string[];
  // Pre-extracted frames for the current turn's GIF (if any). Frame extraction
  // is async (fetch + decode), so the caller does it before this pure
  // assembler runs and hands the result in here.
  currentGifFrames?: ExtractedGifFrames;
  maxInputTokens: number;
};

// Verbatim recent-turn window. Sourced from the shared compaction module so it
// stays coupled to the summarizer's keep-tail invariant (see RECENT_WINDOW).
const RECENT_TARGET = RECENT_WINDOW;

// Builds the note that tells the model the supplied frames are slices of ONE
// animated GIF — never separate images — so it doesn't narrate "three images."
function buildGifNote(frames: ExtractedGifFrames): string {
  if (frames.frames.length === 0) {
    return "[The user sent ONE animated GIF, but its frames could not be processed. Acknowledge the GIF without describing specific contents.]";
  }
  if (frames.frames.length === 1) {
    return "[The user sent ONE animated GIF. The following image is a single still frame sampled from it (the full animation could not be processed). Treat it as one GIF, not a standalone image.]";
  }
  return `[The user sent ONE animated GIF. The following ${frames.frames.length} images are still frames sampled from that single GIF, in order (start → middle → end). Treat them together as one GIF, not as ${frames.frames.length} separate images.]`;
}

// Historical user turns that carried attachments are collapsed to a cheap text
// note rather than re-sending image parts. Essential for token conservation: a
// meme costs ~250 prompt tokens every turn it stays attached, and a GIF would
// cost several times that.
function collapseHistoricalUserContent(
  text: string,
  images?: MessageImage[],
  gifs?: MessageGif[],
): string {
  const trimmed = text.trim();
  const notes: string[] = [];

  if (images && images.length > 0) {
    notes.push(
      images.length === 1
        ? "[User sent an image]"
        : `[User sent ${images.length} images]`,
    );
  }
  if (gifs && gifs.length > 0) {
    notes.push("[User sent an animated GIF]");
  }

  if (notes.length === 0) return trimmed;
  const joined = notes.join("\n");
  return trimmed.length > 0 ? `${trimmed}\n\n${joined}` : joined;
}

// The current user turn is the only message allowed to carry real image parts.
// Text-only with no GIF → plain string (unchanged behavior). Otherwise → an
// array of content parts: optional text part, one image_url part per meme
// (previewUrl, detail:"low"), then — if a GIF was attached — a note part
// explaining the GIF followed by one image_url part per extracted frame (each a
// base64 data URL, detail:"low").
export function buildCurrentUserContent(
  text: string,
  imageUrls?: string[],
  gifFrames?: ExtractedGifFrames,
): string | OpenAIContentPart[] {
  const trimmed = text.trim();
  const hasImages = Boolean(imageUrls && imageUrls.length > 0);
  const hasGif = Boolean(gifFrames);

  if (!hasImages && !hasGif) {
    return trimmed;
  }

  const parts: OpenAIContentPart[] = [];
  if (trimmed.length > 0) {
    parts.push({ type: "text", text: trimmed });
  }
  if (imageUrls) {
    for (const url of imageUrls) {
      parts.push({
        type: "image_url",
        image_url: { url, detail: "low" },
      });
    }
  }
  if (gifFrames) {
    parts.push({ type: "text", text: buildGifNote(gifFrames) });
    for (const frame of gifFrames.frames) {
      parts.push({ type: "image_url", image_url: { url: frame, detail: "low" } });
    }
  }
  return parts;
}

// Pure assembler: takes the candidate inputs and returns the truncated
// message sequence that fits under maxInputTokens. Drops oldest recent
// messages first (never the system, summary, or current). Reports the
// token count it computed so the caller doesn't tokenize twice.
export function assembleFromInputs(args: AssembleArgs): AssembledContext {
  const systemPrompt = args.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const recent = args.recent.slice(-RECENT_TARGET);
  const summaryUsed = Boolean(args.summary && args.summary.trim().length > 0);

  const build = (recentSlice: ChatMessage[]): OpenAIMessage[] => {
    const out: OpenAIMessage[] = [{ role: "system", content: systemPrompt }];
    // Alias injected as a second system message so the main prompt prefix
    // stays cacheable — the large static prompt is the same for every user.
    if (args.userAlias) {
      out.push({
        role: "system",
        content: `The user's name is ${args.userAlias}. Use it naturally when it fits the conversation.`,
      });
    }
    if (summaryUsed) {
      out.push({
        role: "system",
        content: `Conversation summary so far:\n${args.summary!.trim()}`,
      });
    }
    for (const m of recentSlice) {
      out.push(
        m.role === "agent"
          ? { role: "assistant", content: m.text }
          : {
              role: "user",
              content: collapseHistoricalUserContent(m.text, m.images, m.gifs),
            },
      );
    }
    out.push({
      role: "user",
      content: buildCurrentUserContent(
        args.currentText,
        args.currentImageUrls,
        args.currentGifFrames,
      ),
    });
    return out;
  };

  let current = recent.slice();
  let messages = build(current);
  let inputTokens = countMessagesTokens(messages);

  // Drop oldest recent messages until we fit. Keep system/summary/current
  // intact — those are load-bearing.
  while (inputTokens > args.maxInputTokens && current.length > 0) {
    current = current.slice(1);
    messages = build(current);
    inputTokens = countMessagesTokens(messages);
  }

  return {
    messages,
    inputTokens,
    summaryUsed,
    recentMessageCount: current.length,
  };
}

// ----- Firestore wrapper -----

type MessageDoc = {
  role?: "user" | "agent";
  text?: string;
  status?: "complete" | "streaming" | "error";
  images?: MessageImage[];
  gifs?: MessageGif[];
};

type ConversationDoc = {
  summary?: string;
  summaryUpToMessageId?: string | null;
};

function mapMessage(doc: QueryDocumentSnapshot): ChatMessage | null {
  const data = doc.data() as MessageDoc;
  if (data.role !== "user" && data.role !== "agent") return null;
  if (data.status !== "complete") return null;

  const text = typeof data.text === "string" ? data.text : "";
  const images = Array.isArray(data.images) ? data.images : undefined;
  const gifs = Array.isArray(data.gifs) ? data.gifs : undefined;
  const hasImages = Boolean(images && images.length > 0);
  const hasGifs = Boolean(gifs && gifs.length > 0);

  // Keep attachment-only user messages (empty text) so they can be collapsed to
  // placeholders; otherwise require non-empty text as before.
  if (text.length === 0 && !hasImages && !hasGifs) return null;

  const message: ChatMessage = { role: data.role, text };
  if (hasImages) message.images = images;
  if (hasGifs) message.gifs = gifs;
  return message;
}

export type AssembleContextArgs = {
  conversationId: string;
  plan: PlanId;
  currentUserMessage: string;
  // Model-ready image URLs for the current turn (see resolveImageInputs).
  currentImageUrls?: string[];
  // The GIF attached to the current turn (max one). Decoded into sampled frames
  // for the model before assembly.
  currentGif?: MessageGif;
  systemPrompt?: string;
  userAlias?: string | null;
};

export async function assembleContext(args: AssembleContextArgs): Promise<AssembledContext> {
  const db = getFirestore();
  const conversationRef = db.doc(`conversations/${args.conversationId}`);
  const conversationSnap = await conversationRef.get();
  const conversation = conversationSnap.data() as ConversationDoc | undefined;
  const summary = conversation?.summary ?? null;
  const summaryUpToMessageId = conversation?.summaryUpToMessageId ?? null;

  let query = db
    .collection(`conversations/${args.conversationId}/messages`)
    .orderBy("createdAt", "desc")
    .limit(RECENT_TARGET * 2);

  const recentSnap = await query.get();
  let recent: ChatMessage[] = recentSnap.docs
    .reverse()
    .flatMap((d) => {
      const m = mapMessage(d);
      return m ? [m] : [];
    });

  // If a summary cutoff exists, drop any recent messages from before/at the
  // cutoff so we don't double-count summarized history.
  if (summaryUpToMessageId) {
    const cutoffIdx = recentSnap.docs.findIndex((d) => d.id === summaryUpToMessageId);
    if (cutoffIdx >= 0) {
      // recentSnap.docs is reversed compared to `recent`; map indices safely
      // by filtering on doc IDs we kept.
      const keepIds = new Set<string>();
      const reversedDocs = recentSnap.docs.slice().reverse();
      let pastCutoff = false;
      for (const doc of reversedDocs) {
        if (pastCutoff && mapMessage(doc)) keepIds.add(doc.id);
        if (doc.id === summaryUpToMessageId) pastCutoff = true;
      }
      recent = reversedDocs
        .filter((d) => keepIds.has(d.id))
        .flatMap((d) => {
          const m = mapMessage(d);
          return m ? [m] : [];
        });
    }
  }

  // Decode the current turn's GIF into sampled still frames for the model. Done
  // here (async) so the pure assembler can stay synchronous. Never throws.
  const currentGifFrames = args.currentGif
    ? await extractGifFrames(args.currentGif)
    : undefined;

  const planCfg = PLANS[args.plan];
  return assembleFromInputs({
    systemPrompt: args.systemPrompt,
    userAlias: args.userAlias,
    summary,
    recent,
    currentText: args.currentUserMessage,
    currentImageUrls: args.currentImageUrls,
    currentGifFrames,
    maxInputTokens: planCfg.maxInputTokens,
  });
}
