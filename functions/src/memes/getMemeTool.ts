import { logger } from "firebase-functions";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import {
  messageImageSchema,
  type ValidatedMessageImage,
} from "../messages/messageImage";
import { KlipyError, searchMemes } from "./klipy";
import type { ContentFilter, TrendingMeme } from "./types";

// The OpenAI tool the agent may call to attach a single meme to its reply.
// The description carries the *when to use it* policy so the decision lives
// with the model; the runner below only performs the Klipy lookup.
export const GET_MEME_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_meme",
    description:
      "Search Klipy for one meme image to attach to your reply. Call this ONLY when a meme would genuinely improve the moment — the user is joking, celebrating, venting about something low-stakes, reacting casually, or being playful. Do NOT call it in serious, sensitive, professional, legal, medical, financial, safety-related, or emotionally heavy conversations, or when the user clearly wants a direct technical or factual answer. Most messages do not need a meme. Always write your normal text reply as well — the meme is an extra touch, never a replacement for actually responding.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A short meme search query (about 2–5 words) capturing the vibe or reaction, e.g. 'mind blown', 'celebration dance', 'monday tired'.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

// Appended to the system prompt when the meme tool is enabled, so the persona
// knows the capability exists and the restraint expected around it.
export const MEME_TOOL_GUIDANCE = `You can call the get_meme tool to attach a single meme image to your reply when it would genuinely add to the moment — when the user is joking, celebrating, venting about something low-stakes, reacting casually, or being playful. Pass a short search query that captures the vibe. Do NOT use memes in serious, sensitive, professional, legal, medical, financial, safety-related, or emotionally heavy conversations, or when the user just wants a direct technical or factual answer. Most messages do not need a meme. Always write your normal text reply either way — the meme is an extra touch, never a substitute for actually responding.`;

const memeArgsSchema = z.object({
  query: z.string().trim().min(1).max(100),
});

export type GetMemeDeps = {
  // The Klipy app key (path segment on every request).
  apiKey: string;
  // Stable per-user id for Klipy personalization — the Firebase uid.
  customerId: string;
  locale?: string;
  contentFilter?: ContentFilter;
};

export type GetMemeResult = {
  // Compact JSON string handed back to the model as the tool message. Never
  // contains the asset URL — the model only needs to know the lookup succeeded
  // so it can phrase its reply; the image is attached out-of-band.
  content: string;
  // The chosen meme as a message attachment, surfaced to the caller. Absent
  // when no usable result was found or Klipy was unavailable.
  meme?: ValidatedMessageImage;
};

// Map the top Klipy hit onto our message-attachment shape, then revalidate it
// through the shared schema (same host/url rules user-supplied memes face) so a
// malformed CDN URL never reaches persistence or the model.
function toMessageImage(meme: TrendingMeme): ValidatedMessageImage | null {
  const candidate = {
    id: meme.id,
    source: "klipy" as const,
    url: meme.url,
    previewUrl: meme.previewUrl,
    width: meme.width || undefined,
    height: meme.height || undefined,
    attribution: "Powered by Klipy",
    memeId: meme.id,
  };
  const parsed = messageImageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// Executes the get_meme tool: parses the model's arguments, searches Klipy, and
// returns the single best match. Never throws — a bad query, no results, or a
// Klipy outage all resolve to a "not found" tool message so the turn still
// produces a normal text reply.
export async function runGetMeme(
  rawArguments: string,
  deps: GetMemeDeps,
): Promise<GetMemeResult> {
  let query: string;
  try {
    query = memeArgsSchema.parse(JSON.parse(rawArguments)).query;
  } catch {
    return { content: JSON.stringify({ found: false, reason: "invalid_query" }) };
  }

  try {
    const result = await searchMemes({
      apiKey: deps.apiKey,
      query,
      page: 1,
      // Klipy's search endpoint requires per_page >= 8; we only use the top hit.
      perPage: 8,
      customerId: deps.customerId,
      locale: deps.locale,
      // Conservative default safety level for a consumer chat app.
      contentFilter: deps.contentFilter ?? "medium",
    });

    const top = result.memes[0];
    const meme = top ? toMessageImage(top) : null;
    if (!meme) {
      return { content: JSON.stringify({ found: false }) };
    }

    return {
      content: JSON.stringify({ found: true, title: top.title || query }),
      meme,
    };
  } catch (err) {
    if (err instanceof KlipyError) {
      logger.warn("[getMeme] klipy error", {
        status: err.status,
        message: err.message,
      });
    } else {
      logger.error("[getMeme] unexpected error", { err });
    }
    return { content: JSON.stringify({ found: false, reason: "unavailable" }) };
  }
}
