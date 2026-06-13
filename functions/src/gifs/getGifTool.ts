import { logger } from "firebase-functions";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { pickIndexByRandomness } from "../klipy/pickByRandomness";
import {
  messageGifSchema,
  type ValidatedMessageGif,
} from "../messages/messageGif";
import { KlipyError, searchGifs } from "./klipy";
import type { ContentFilter } from "../memes/types";
import type { TrendingGif } from "./types";

// The OpenAI tool the agent may call to attach a single animated GIF to its
// reply. Sibling of get_meme — a GIF is the more dynamic/animated choice. The
// description carries the *when to use it* policy so the decision lives with
// the model; the runner below only performs the Klipy lookup.
export const GET_GIF_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_gif",
    description:
      "Attach ONE real animated GIF to your reply by searching Klipy. When a visual reaction fits, this is your PREFERRED format — animated GIFs are richer, more expressive, and have far better search hits than the still-meme library, so reach for get_gif before get_meme. Use them on a good number of casual turns, but be selective: roughly every other casual reaction, NOT every message. Plenty of replies should stay text-only so the GIFs keep their punch — a GIF on every turn gets old fast. Attach one when the moment genuinely calls for it (the user is joking, hyped, celebrating, reacting, being playful, roasting, confused, shocked, greeting, or venting about something low-stakes AND a reaction image clearly adds something). Only fall back to get_meme when a specific still caption/format genuinely beats motion. Skip a visual entirely on serious, sensitive, technical, or emotionally heavy turns, or when the user just wants a straight answer. Attach at most ONE image per reply total — either a GIF (get_gif) OR a meme (get_meme), never both; when you do attach one, default to the GIF. This attaches an IMAGE that the app shows on its own, so you must still write a normal text reply and must never title, describe, link, or embed it yourself. Klipy matches references, not raw emotions — anchor the query to a recognizable reaction or named reference, not a description of a feeling.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A short GIF search query (about 2–5 words) anchored to a recognizable reaction or named reference, NOT a description of an emotion. Klipy matches references, so use 'mic drop', 'happy dance', 'facepalm', 'slow clap', a named character/show, or the concrete subject — not 'feeling proud' or 'shocked confusion'. Avoid vague queries like 'funny gif' or 'reaction'.",
        },
        randomness_factor: {
          type: "integer",
          minimum: 1,
          maximum: 30,
          description:
            "How deep to sample the ranked results (the search is literal and frozen: the same query returns the same top hits every time, so generic queries NEED high randomness to vary; sampling is front-biased, so deep hits stay rare). 1-2 = exact named reference you're deliberately invoking. 3-6 = named-but-broad references and descriptive subject+action queries. 15-20 = generic/common words ('handshake', 'crying laughing') with huge pools whose top hits never change. 25-30 = grab-bag chaos requests ('send me some brainrot'). Default 1.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

const gifArgsSchema = z.object({
  query: z.string().trim().min(1).max(100),
  // How deep to sample the ranked results. 1 = always the top hit; 30 = the
  // chaos band for grab-bag requests (front-biased decay keeps the deep tail
  // rare). Invalid or missing values fall back to 1 (exact) rather than
  // failing the tool.
  randomness_factor: z.coerce.number().int().min(1).max(30).catch(1).default(1),
});

export type GetGifDeps = {
  apiKey: string;
  customerId: string;
  locale?: string;
  contentFilter?: ContentFilter;
};

export type GetGifResult = {
  // Compact JSON string handed back to the model as the tool message. Never
  // contains the asset URL — the model only needs to know the lookup succeeded.
  content: string;
  // The chosen GIF as a message attachment, surfaced to the caller. Absent when
  // no usable result was found or Klipy was unavailable.
  gif?: ValidatedMessageGif;
  // The chosen GIF's Klipy title — a short, human description (e.g. "rat
  // dancing"). The media pipeline hands this to the reply model so it knows what
  // GIF is attached and can riff on it; never shown to the user verbatim.
  title?: string;
};

// Map the top Klipy GIF hit onto our attachment shape, then revalidate it
// through the shared schema (same host rules user-supplied GIFs face).
function toMessageGif(gif: TrendingGif): ValidatedMessageGif | null {
  const candidate = {
    id: gif.id,
    source: "klipy-gif" as const,
    url: gif.url,
    previewUrl: gif.previewUrl,
    frameSourceUrl: gif.frameSourceUrl,
    width: gif.width || undefined,
    height: gif.height || undefined,
    attribution: "Powered by Klipy",
    gifId: gif.id,
    // Persisted so the media decider can avoid repeating recent reactions.
    title: gif.title || undefined,
  };
  const parsed = messageGifSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// Executes the get_gif tool: parses the model's arguments, searches Klipy GIFs,
// and returns the single best match. Never throws — a bad query, no results, or
// a Klipy outage all resolve to a "not found" tool message so the turn still
// produces a normal text reply.
export async function runGetGif(
  rawArguments: string,
  deps: GetGifDeps,
): Promise<GetGifResult> {
  let query: string;
  let randomnessFactor: number;
  try {
    const args = gifArgsSchema.parse(JSON.parse(rawArguments));
    query = args.query;
    randomnessFactor = args.randomness_factor;
  } catch {
    return {
      content: JSON.stringify({ found: false, reason: "invalid_query" }),
    };
  }

  try {
    const result = await searchGifs({
      apiKey: deps.apiKey,
      query,
      page: 1,
      // Klipy's search endpoint requires per_page >= 8 and caps at 50. Size
      // the page to the requested sampling window (+1 straggler) — a short
      // page silently shrinks the high band's window to whatever was fetched.
      perPage: Math.min(50, Math.max(16, randomnessFactor + 2)),
      customerId: deps.customerId,
      locale: deps.locale,
      contentFilter: deps.contentFilter ?? "medium",
    });

    // Validate every hit to the attachment shape first (drops off-host URLs),
    // then let the randomness factor pick among the usable ones. With factor 1
    // this is just the top hit; higher factors sample a few deep with a strong
    // front bias — without us reading each result to choose (token waste).
    const candidates = result.gifs
      .map((g) => ({ gif: toMessageGif(g), title: g.title }))
      .filter(
        (c): c is { gif: ValidatedMessageGif; title: string } => c.gif !== null,
      );
    const chosen =
      candidates[pickIndexByRandomness(candidates.length, randomnessFactor)] ??
      null;
    if (!chosen) {
      return { content: JSON.stringify({ found: false }) };
    }

    return {
      content: JSON.stringify({ found: true }),
      gif: chosen.gif,
      title: chosen.title,
    };
  } catch (err) {
    if (err instanceof KlipyError) {
      logger.warn("[getGif] klipy error", {
        status: err.status,
        message: err.message,
      });
    } else {
      logger.error("[getGif] unexpected error", { err });
    }
    return { content: JSON.stringify({ found: false, reason: "unavailable" }) };
  }
}
