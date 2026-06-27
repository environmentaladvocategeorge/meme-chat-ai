import { logger } from "firebase-functions";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { pickIndexByRandomness } from "../klipy/pickByRandomness";
import {
  messageImageSchema,
  type ValidatedMessageImage,
} from "../messages/messageImage";
import { KlipyError, searchMemes } from "./klipy";
import type { ContentFilter, TrendingMeme } from "./types";
import type { ModelUsage } from "../billing/ledger";

// Curated bank of meme references that exist on Klipy as near-exact titles,
// each paired with the moment it fits. Klipy's search matches REFERENCES, not
// free-form emotions or descriptions — searching "shocked confusion" returns
// junk, but searching the exact title "Blinking Guy Meme Reaction" returns the
// meme. So the model maps the moment to one of these vibes and searches the
// title verbatim (with randomness_factor 1). Retained as reference data: the
// persona prompt now carries its own (trimmed) meme bank, so this fuller list
// is no longer injected into the system prompt — keep it for future reuse.
export const MEME_REFERENCE_LIBRARY: ReadonlyArray<{
  name: string;
  vibe: string;
}> = [
  { name: "Whoopdidy Scoop", vibe: "goofy nonsense" },
  { name: "Blinking Guy Meme Reaction", vibe: "shocked confusion" },
  { name: "Forrest Gump Wave", vibe: "wholesome greeting" },
  { name: "Creep Yes", vibe: "weird approval" },
  { name: "Jack Nicholson's Creepy Smile", vibe: "smug evil" },
  { name: "Tung Tung Sahur", vibe: "loud chaos" },
  { name: "Come Over Here Roman Bürki", vibe: "playful callout" },
  { name: "Dog Awkward", vibe: "social awkwardness" },
  { name: "Spongebob Meme and Dog Standing Up", vibe: "confused waiting" },
  { name: "Cat Meme", vibe: "quiet judgment" },
  { name: "gigachad", vibe: "confident win" },
  { name: "dog cooked meme", vibe: "total defeat" },
  { name: "ishowspeed calm", vibe: "barely composed" },
  { name: "tuff baby", vibe: "tiny flex" },
  { name: "brainrot stare meme", vibe: "empty-headed confusion" },
  { name: "let him cook", vibe: "chaotic confidence" },
  { name: "side eye cat meme", vibe: "quiet judgment" },
];


// The OpenAI tool the agent may call to attach a single meme to its reply.
// The description carries the *when to use it* policy so the decision lives
// with the model; the runner below only performs the Klipy lookup.
export const GET_MEME_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_meme",
    description:
      "Attach ONE real STILL meme image to your reply by searching Klipy. This is the SECONDARY visual option — for animated reactions prefer get_gif, which is richer and returns more relevant results. Only use get_meme when a specific still caption/format genuinely says it better than motion could (a classic captioned reaction image the user is clearly invoking). Otherwise reach for get_gif. Like get_gif, this is on-brand on casual turns when the user is joking, hyped, celebrating, reacting, being playful, or venting about something low-stakes. Skip it on serious, sensitive, technical, or emotionally heavy turns, or when the user just wants a straight answer (apply the same serious-topic restraint your persona instructions already define). At most ONE image per reply total — either a GIF (get_gif) OR a meme (get_meme), never both, and default to the GIF. This attaches an IMAGE, which is separate from your normal meme-y wording — the image is shown to the user automatically on its own, so you must still write a normal text reply and must never title, describe, link, or embed it yourself. Klipy matches exact meme REFERENCES, not raw emotions — search the verbatim name of a known meme (prefer one from your provided meme bank), not a description of a feeling.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The exact name/reference of a meme to search, NOT a description of an emotion. Prefer a verbatim title from your meme bank (e.g. 'Blinking Guy Meme Reaction', 'let him cook', 'gigachad'). Only improvise a query when nothing in the bank fits, and even then anchor it to a real, recognizable meme reference.",
        },
        randomness_factor: {
          type: "integer",
          minimum: 1,
          maximum: 30,
          description:
            "How deep to sample the ranked results (the search is literal and frozen: the same query returns the same top hits every time, so generic queries NEED high randomness to vary; sampling is front-biased, so deep hits stay rare). 1-2 = exact meme reference (e.g. a bank title). 3-6 = named-but-broad references and descriptive queries. 15-20 = generic/common words with huge pools whose top hits never change. 25-30 = grab-bag chaos requests ('send me some brainrot'). Default 1.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

const memeArgsSchema = z.object({
  query: z.string().trim().min(1).max(100),
  // How deep to sample the ranked results. 1 = always the top hit; 30 = the
  // chaos band for grab-bag requests (front-biased decay keeps the deep tail
  // rare). Invalid or missing values fall back to 1 (exact) rather than
  // failing the tool.
  randomness_factor: z.coerce.number().int().min(1).max(30).catch(1).default(1),
});

export type GetMemeDeps = {
  // The Klipy app key (path segment on every request).
  apiKey: string;
  // Stable per-user id for Klipy personalization — the Firebase uid.
  customerId: string;
  locale?: string;
  contentFilter?: ContentFilter;
  // Klipy ids to drop from the result pool before picking — the meme/GIF the
  // user JUST sent plus the bot's recent reactions. A hard backstop to the
  // prompt's never-echo rule so the exact same asset is never re-sent.
  excludeIds?: ReadonlySet<string>;
  // Optional look-&-pick selector (see getGifTool's GetGifDeps.selectIndex):
  // given the ranked candidate titles, returns the chosen index + usage. Absent
  // → blind randomness pick. Only passed for broad queries; references lock to
  // the top hit.
  selectIndex?: (
    titles: string[],
  ) => Promise<{ index: number; usage: ModelUsage }>;
};

export type GetMemeResult = {
  // Compact JSON string handed back to the model as the tool message. Never
  // contains the asset URL — the model only needs to know the lookup succeeded
  // so it can phrase its reply; the image is attached out-of-band.
  content: string;
  // The chosen meme as a message attachment, surfaced to the caller. Absent
  // when no usable result was found or Klipy was unavailable.
  meme?: ValidatedMessageImage;
  // The chosen meme's Klipy title — a short description handed to the reply
  // model (via the media pipeline) so it knows what's attached. Not shown raw.
  title?: string;
  // Usage from the optional look-&-pick selector, surfaced so the orchestrator
  // can bill it alongside the decider + reply. Absent when no selector ran.
  selectUsage?: ModelUsage;
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
    // Persisted so the media decider can avoid repeating recent reactions.
    title: meme.title || undefined,
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
  let randomnessFactor: number;
  try {
    const args = memeArgsSchema.parse(JSON.parse(rawArguments));
    query = args.query;
    randomnessFactor = args.randomness_factor;
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
      // Klipy's search endpoint requires per_page >= 8 and caps at 50. Size
      // the page to the requested sampling window (+1 straggler) — a short
      // page silently shrinks the high band's window to whatever was fetched.
      perPage: Math.min(50, Math.max(16, randomnessFactor + 2)),
      customerId: deps.customerId,
      locale: deps.locale,
      // Conservative default safety level for a consumer chat app.
      contentFilter: deps.contentFilter ?? "medium",
    });

    // Validate every hit to the attachment shape first (drops off-host URLs),
    // then let the randomness factor pick among the usable ones. With factor 1
    // this is just the top hit; higher factors sample a few deep with a strong
    // front bias — without us reading each result to choose (token waste).
    const exclude = deps.excludeIds;
    const candidates = result.memes
      .map((m) => ({ meme: toMessageImage(m), title: m.title }))
      .filter(
        (c): c is { meme: ValidatedMessageImage; title: string } =>
          c.meme !== null,
      )
      // Never re-send the user's own meme or a recent reaction: drop excluded
      // ids so the pick can only land on a fresh asset.
      .filter((c) => !exclude || !exclude.has(c.meme.id));
    if (candidates.length === 0) {
      return { content: JSON.stringify({ found: false }) };
    }

    // Look-&-pick when a selector is supplied (broad queries) with a real
    // choice; otherwise the blind front-biased randomness pick.
    let index: number;
    let selectUsage: ModelUsage | undefined;
    if (deps.selectIndex && candidates.length > 1) {
      const sel = await deps.selectIndex(candidates.map((c) => c.title));
      index =
        Number.isInteger(sel.index) &&
        sel.index >= 0 &&
        sel.index < candidates.length
          ? sel.index
          : 0;
      selectUsage = sel.usage;
    } else {
      index = pickIndexByRandomness(candidates.length, randomnessFactor);
    }
    const chosen = candidates[index] ?? null;
    if (!chosen) {
      return { content: JSON.stringify({ found: false }) };
    }

    // The `content` string still hides the title from any model that reads it as
    // a tool message (legacy path). The media pipeline instead uses `title`
    // out-of-band to brief the reply model on what's attached.
    return {
      content: JSON.stringify({ found: true }),
      meme: chosen.meme,
      title: chosen.title,
      selectUsage,
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
