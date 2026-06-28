import type { MessageGif } from "./messageGif";
import type { MessageImage } from "./messageImage";
import type { MessageSticker } from "./messageSticker";

// The Klipy titles ("meme names") the user attached to the CURRENT turn. Only
// Klipy-sourced memes/GIFs/stickers carry a `title`; uploads never do. We
// surface these to the reply model and the media decider so they can recognize a
// named meme reference instead of guessing purely from the pixels.
//
// Everything here is additive and gated on presence: older clients don't send
// `title` (and never send stickers), so `memes`/`stickers` come back empty and
// `gif` undefined, and every consumer falls back to today's exact behavior.
// That's what lets the backend ship ahead of the client without breaking live
// users.
export type CurrentAttachmentTitles = {
  // Klipy meme titles in attachment order (uploads excluded — they have none).
  memes: string[];
  // The single GIF's title, if the user sent a titled Klipy GIF.
  gif?: string;
  // Klipy sticker titles in attachment order (newer clients only). Optional so
  // older call sites / fixtures that predate stickers stay valid; every consumer
  // treats absent as empty.
  stickers?: string[];
  // The search term the user typed to find the sticker(s), if any (absent when
  // picked from trending). Surfaced for extra reaction context.
  stickerQuery?: string;
};

function cleanTitle(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Collects the Klipy titles off the current turn's attachments. Pure; safe on
// empty/undefined inputs.
export function collectCurrentAttachmentTitles(
  images: MessageImage[] | undefined,
  gifs: MessageGif[] | undefined,
  stickers?: MessageSticker[] | undefined,
): CurrentAttachmentTitles {
  const memes: string[] = [];
  for (const img of images ?? []) {
    if (img.source !== "klipy") continue;
    const title = cleanTitle(img.title);
    if (title) memes.push(title);
  }
  const gif = cleanTitle(gifs?.[0]?.title) ?? undefined;
  const stickerTitles: string[] = [];
  let stickerQuery: string | undefined;
  for (const s of stickers ?? []) {
    const title = cleanTitle(s.title);
    if (title) stickerTitles.push(title);
    if (!stickerQuery) {
      const q = cleanTitle(s.searchQuery);
      if (q) stickerQuery = q;
    }
  }
  return { memes, gif, stickers: stickerTitles, stickerQuery };
}

export function hasAttachmentTitles(titles: CurrentAttachmentTitles): boolean {
  return (
    titles.memes.length > 0 ||
    Boolean(titles.gif) ||
    (titles.stickers?.length ?? 0) > 0
  );
}

// A one-line hint appended to the media decider's current-message text so it can
// match a named meme/GIF/sticker the user just sent. Returns null when there are
// no titles. When no stickers are present the output is byte-identical to the
// original meme/GIF hint, so the decider payload is unchanged for older clients.
export function buildDeciderAttachmentHint(
  titles: CurrentAttachmentTitles,
): string | null {
  const mediaNames = [...titles.memes, ...(titles.gif ? [titles.gif] : [])];
  const stickerNames = titles.stickers ?? [];
  if (mediaNames.length === 0 && stickerNames.length === 0) return null;

  // No stickers → byte-identical to the original meme/GIF hint (older clients).
  if (stickerNames.length === 0) {
    const quoted = mediaNames.map((n) => `"${n}"`).join(", ");
    return (
      `[The attachment the user sent is a known meme/GIF named ${quoted}. ` +
      `If that's a recognizable reference, base your reaction on it.]`
    );
  }

  // Stickers present (newer clients): fold them into the hint.
  const quoted = [...mediaNames, ...stickerNames]
    .map((n) => `"${n}"`)
    .join(", ");
  const searched = titles.stickerQuery
    ? ` (the user searched "${titles.stickerQuery}")`
    : "";
  return (
    `[The user's attachment(s) include known meme/GIF/sticker references named ${quoted}${searched}. ` +
    `If any is a recognizable reference, base your reaction on it.]`
  );
}

// A text content-part string naming the meme(s) shown to the reply model, so it
// can recognize the reference alongside the actual pixels. Returns null when no
// meme titles are present (GIF titles are folded into the GIF note instead).
export function buildMemeTitleNote(
  titles: CurrentAttachmentTitles,
): string | null {
  if (titles.memes.length === 0) return null;
  const quoted = titles.memes.map((n) => `"${n}"`).join(", ");
  const noun = titles.memes.length === 1 ? "meme" : "memes";
  return (
    `[For reference, the ${noun} shown above ${titles.memes.length === 1 ? "is" : "are"} known as ${quoted}. ` +
    `Use the name to recognize the reference, but don't read the title text aloud.]`
  );
}

// A text content-part string introducing the sticker still(s) the user sent so
// the reply model treats them as reaction stickers (not photos) and can react in
// character. `count` comes from the sticker still URLs; titles + the search term
// (when present) enrich the note. Returns null when count <= 0, so sticker-free
// turns are byte-identical for older clients.
export function buildStickerNote(
  count: number,
  titles?: CurrentAttachmentTitles,
): string | null {
  if (count <= 0) return null;
  const names = titles?.stickers ?? [];
  const named =
    names.length > 0 ? ` named ${names.map((n) => `"${n}"`).join(", ")}` : "";
  const searched = titles?.stickerQuery
    ? ` (found by searching "${titles.stickerQuery}")`
    : "";
  const subj = count === 1 ? "it" : "them";
  const lead =
    count === 1
      ? "The following image is a sticker"
      : `The following ${count} images are stickers`;
  return (
    `[${lead} the user sent${named}${searched}. ` +
    `They're transparent reaction stickers (like stamps), not photos — react ` +
    `naturally to ${subj}, but don't read any names aloud or describe ${subj} as photos.]`
  );
}
