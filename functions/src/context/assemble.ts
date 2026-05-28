import { getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { ChatMessage } from "../agent/types";
import { PLANS, type PlanId } from "../billing/plans";
import { countMessagesTokens } from "./tokens";

const DEFAULT_SYSTEM_PROMPT =
  "You are Me-Me, a friendly and concise chat assistant. Reply in the user's language. Keep answers focused; offer detail only when the user asks for it.";

export type OpenAIMessage = { role: "system" | "user" | "assistant"; content: string };

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
  maxInputTokens: number;
};

const RECENT_TARGET = 10;

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
      out.push({
        role: m.role === "agent" ? "assistant" : "user",
        content: m.text,
      });
    }
    out.push({ role: "user", content: args.currentText });
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
};

type ConversationDoc = {
  summary?: string;
  summaryUpToMessageId?: string | null;
};

function mapMessage(doc: QueryDocumentSnapshot): ChatMessage | null {
  const data = doc.data() as MessageDoc;
  if (
    (data.role === "user" || data.role === "agent") &&
    typeof data.text === "string" &&
    data.text.length > 0 &&
    data.status === "complete"
  ) {
    return { role: data.role, text: data.text };
  }
  return null;
}

export type AssembleContextArgs = {
  conversationId: string;
  plan: PlanId;
  currentUserMessage: string;
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
    maxInputTokens: planCfg.maxInputTokens,
  });
}
