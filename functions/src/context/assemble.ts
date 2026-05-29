import { getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { ChatMessage } from "../agent/types";
import { PLANS, type PlanId } from "../billing/plans";
import type { MessageImage } from "../messages/messageImage";
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
  summary?: string | null;
  recent: ChatMessage[]; // ordered oldest → newest, already filtered to status: complete
  currentText: string;
  currentImages?: MessageImage[];
  maxInputTokens: number;
};

const RECENT_TARGET = 10;

// Historical user turns that carried images are collapsed to a cheap text note
// rather than re-sending the image_url parts. This is essential for token
// conservation: a meme costs ~250 prompt tokens every turn it stays attached.
function collapseHistoricalUserContent(
  text: string,
  images?: MessageImage[],
): string {
  const trimmed = text.trim();
  if (!images || images.length === 0) return trimmed;

  const placeholder =
    images.length === 1
      ? "[User sent a Klipy meme image]"
      : `[User sent ${images.length} Klipy meme images]`;

  return trimmed.length > 0 ? `${trimmed}\n\n${placeholder}` : placeholder;
}

// The current user turn is the only message allowed to carry real image parts.
// Text-only → plain string (unchanged behavior). With images → an array of
// content parts: optional text part (only when non-empty) + one image_url part
// per attachment, always with explicit detail:"low" and the previewUrl.
export function buildCurrentUserContent(
  text: string,
  images?: MessageImage[],
): string | OpenAIContentPart[] {
  const trimmed = text.trim();

  if (!images || images.length === 0) {
    return trimmed;
  }

  const parts: OpenAIContentPart[] = [];
  if (trimmed.length > 0) {
    parts.push({ type: "text", text: trimmed });
  }
  for (const image of images) {
    parts.push({
      type: "image_url",
      image_url: { url: image.previewUrl, detail: "low" },
    });
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
          : { role: "user", content: collapseHistoricalUserContent(m.text, m.images) },
      );
    }
    out.push({
      role: "user",
      content: buildCurrentUserContent(args.currentText, args.currentImages),
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
  const hasImages = Boolean(images && images.length > 0);

  // Keep image-only user messages (empty text) so their attachments can be
  // collapsed to placeholders; otherwise require non-empty text as before.
  if (text.length === 0 && !hasImages) return null;

  return hasImages ? { role: data.role, text, images } : { role: data.role, text };
}

export type AssembleContextArgs = {
  conversationId: string;
  plan: PlanId;
  currentUserMessage: string;
  currentImages?: MessageImage[];
  systemPrompt?: string;
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

  const planCfg = PLANS[args.plan];
  return assembleFromInputs({
    systemPrompt: args.systemPrompt,
    summary,
    recent,
    currentText: args.currentUserMessage,
    currentImages: args.currentImages,
    maxInputTokens: planCfg.maxInputTokens,
  });
}
