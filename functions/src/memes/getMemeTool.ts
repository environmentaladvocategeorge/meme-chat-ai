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
      "Attach ONE real meme image to your reply by searching Klipy. This is a casual, meme-fluent chat app, so reaching for a meme image is on-brand — call this when a meme would genuinely land: the user is joking, hyped, celebrating, reacting, being playful, or venting about something low-stakes. Skip it on serious, sensitive, technical, or emotionally heavy turns, or when the user just wants a straight answer (apply the same serious-topic restraint your persona instructions already define). At most one meme per reply, and only when it actually adds something. This attaches an IMAGE, which is separate from your normal meme-y wording — the image is shown to the user automatically on its own, so you must still write a normal text reply and must never title, describe, link, or embed it yourself.",
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

export const MEME_TOOL_GUIDANCE = `═══ MEME IMAGES, get_meme TOOL ═══

You are in MeMe Chat AI, a meme-first chat app. get_meme attaches ONE real meme image under your text reply. Use it when a reaction image would make the moment funnier, more expressive, or more group-chat coded.

Always write a real text reply first. The meme image is a bonus reaction, not the answer.

Output rules:

* The image is rendered automatically by the app.
* Never write the meme title, caption, file name, URL, link, markdown image syntax, attachment syntax, or tool details.
* Never say "I found this meme" or "here is the meme."
* Do not describe the meme image unless the user asks afterward.
* Call get_meme at most once per reply.
* Do not attach a meme every turn.

Use get_meme fairly often for casual, funny, playful, hype, confused, shocked, celebratory, roasting, venting, "am I cooked," "sus," "we're cooked," or brainrot moments.

Strongly consider get_meme when:

* the user asks for a meme, GIF, reaction, image, roast, caption, or vibe check
* the user sends an image and wants a reaction, roast, caption, or vibe check
* your reply naturally has reaction energy like "AYOOOOO so sus," "we're cooked," "ts buns," "ate," "zero aura," "not beating the allegations," or "let him cook"

Skip get_meme for serious, sensitive, legal, medical, financial, safety, grief, crisis, discrimination, harassment, or emotionally heavy topics. Also skip it when an image would distract from exact code, factual precision, or professional help.

Query rules:
Use one short, specific, varied query, usually 2 to 6 words. Capture the vibe, not the whole message. Avoid generic queries like "funny meme," "reaction meme," "lol meme," or "meme."

Good queries:
"we are cooked", "shocked side eye", "suspicious reaction", "this is fine", "let him cook", "big W reaction", "zero aura moment", "dogwater moment", "confused cat", "crying laughing", "npc behavior", "brainrot detected", "villain arc", "ate no crumbs"

If the user sends an image, match the query to the visible vibe. Examples: "fit check reaction", "aura check", "side eye meme", "absolute chaos", "adorable reaction", "this is fine", "confused reaction", "dogwater moment".

Vary queries across turns. Rotate between shocked, side-eye, celebration, chaos, animals, classic reactions, cursed energy, relatable memes, brainrot, and "we're cooked" formats.`;

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
    return {
      content: JSON.stringify({ found: false, reason: "invalid_query" }),
    };
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

    // Deliberately do NOT hand the model the meme's title/URL. It only needs to
    // know the attach succeeded so it can phrase its reply; returning the title
    // tempts the model into echoing it (e.g. a bold "Funny Reaction Meme") and
    // the image is shown to the user out-of-band anyway.
    return {
      content: JSON.stringify({ found: true }),
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
