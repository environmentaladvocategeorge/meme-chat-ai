import { logger } from "firebase-functions";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
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
      "Attach ONE real animated GIF to your reply by searching Klipy. This is your PREFERRED way to drop a visual reaction — animated GIFs are richer, more expressive, and have far better search hits than the still-meme library, so reach for get_gif first and reach for it OFTEN on casual turns: whenever the user is joking, hyped, celebrating, reacting, being playful, roasting, confused, shocked, or venting about something low-stakes, a GIF almost always lands. Only fall back to get_meme when a specific still caption/format genuinely beats motion. Skip a visual entirely on serious, sensitive, technical, or emotionally heavy turns, or when the user just wants a straight answer. Attach at most ONE image per reply total — either a GIF (get_gif) OR a meme (get_meme), never both; default to the GIF. This attaches an IMAGE that the app shows on its own, so you must still write a normal text reply and must never title, describe, link, or embed it yourself. Make the search query genuinely relevant to THIS moment so the GIF actually matches what you're reacting to.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A short, specific GIF search query (about 2–5 words) that matches THIS exact moment — the reaction or the actual subject being discussed, not a generic vibe. Anchor it to what's really happening, e.g. 'excited happy dance', 'dramatic mic drop', 'facepalm disappointed', 'mind blown explosion', or the concrete topic like 'cat knocking cup off table'. Avoid vague queries like 'funny gif' or 'reaction'.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

export const GIF_TOOL_GUIDANCE = `═══ ANIMATED GIFS, get_gif TOOL (your DEFAULT visual reaction) ═══

get_gif attaches ONE real animated GIF under your text reply, and it is your go-to way to react with an image. Animated GIFs are richer and more expressive than still memes, and Klipy's GIF search returns far more relevant, on-point results than its meme search — so on casual turns, reach for get_gif FIRST and reach for it often. A GIF lands whenever the moment has any energy: joking, hyped, celebrating, reacting, roasting, confused, shocked, playful, or venting about something low-stakes.

GIF over meme. When you're deciding whether to attach an image, default to a GIF. Only use get_meme instead when a specific still caption/format clearly says it better than motion could — otherwise the GIF wins.

ONE attachment per reply, total. Choose EITHER a GIF (get_gif) OR a meme (get_meme), never both in the same reply, and prefer the GIF.

Always write a real text reply first. The GIF is a bonus reaction, not the answer.

Output rules (same as memes):

* The GIF is rendered automatically by the app.
* Never write the GIF title, caption, file name, URL, link, markdown image syntax, attachment syntax, or tool details.
* Never say "I found this GIF" or "here is a GIF."
* Do not describe the GIF unless the user asks afterward.

Query rules — make it RELEVANT:
The search is only as good as the query, so make the query genuinely match THIS moment, not a generic vibe. Use one short, specific query, usually 2 to 5 words. Anchor it to the actual reaction AND/OR the concrete subject being discussed so the GIF clearly fits.
* Good (specific, relevant): "excited happy dance", "dramatic mic drop", "disappointed facepalm", "slow clap sarcastic", "mind blown explosion", "victory celebration", and topic-anchored ones like "cat knocking cup off table", "buzzer beater game winner".
* Bad (too vague): "funny gif", "reaction gif", "lol", "meme".
If the user sent an image, match the query to what's actually visible in it. Vary your queries across turns so reactions don't repeat.`;

const gifArgsSchema = z.object({
  query: z.string().trim().min(1).max(100),
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
  try {
    query = gifArgsSchema.parse(JSON.parse(rawArguments)).query;
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
      // Klipy's search endpoint requires per_page >= 8; we only use the top hit.
      perPage: 8,
      customerId: deps.customerId,
      locale: deps.locale,
      contentFilter: deps.contentFilter ?? "medium",
    });

    const top = result.gifs[0];
    const gif = top ? toMessageGif(top) : null;
    if (!gif) {
      return { content: JSON.stringify({ found: false }) };
    }

    return {
      content: JSON.stringify({ found: true }),
      gif,
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
