import type { MessageGif } from "./messageGif";
import type { MessageImage } from "./messageImage";

// The Klipy titles ("meme names") the user attached to the CURRENT turn. Only
// Klipy-sourced memes/GIFs carry a `title`; uploads never do. We surface these
// to the reply model and the media decider so they can recognize a named meme
// reference instead of guessing purely from the pixels.
//
// Everything here is additive and gated on presence: older clients don't send
// `title`, so `memes` comes back empty and `gif` undefined, and every consumer
// falls back to today's exact behavior. That's what lets the backend ship ahead
// of the client without breaking live users.
export type CurrentAttachmentTitles = {
  // Klipy meme titles in attachment order (uploads excluded — they have none).
  memes: string[];
  // The single GIF's title, if the user sent a titled Klipy GIF.
  gif?: string;
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
): CurrentAttachmentTitles {
  const memes: string[] = [];
  for (const img of images ?? []) {
    if (img.source !== "klipy") continue;
    const title = cleanTitle(img.title);
    if (title) memes.push(title);
  }
  const gif = cleanTitle(gifs?.[0]?.title) ?? undefined;
  return { memes, gif };
}

export function hasAttachmentTitles(titles: CurrentAttachmentTitles): boolean {
  return titles.memes.length > 0 || Boolean(titles.gif);
}

// A one-line hint appended to the media decider's current-message text so it can
// match a named meme/GIF the user just sent. Returns null when there are no
// titles, so the decider payload stays byte-identical for older clients.
export function buildDeciderAttachmentHint(
  titles: CurrentAttachmentTitles,
): string | null {
  const names = [...titles.memes, ...(titles.gif ? [titles.gif] : [])];
  if (names.length === 0) return null;
  const quoted = names.map((n) => `"${n}"`).join(", ");
  return (
    `[The attachment the user sent is a known meme/GIF named ${quoted}. ` +
    `If that's a recognizable reference, base your reaction on it.]`
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
