import { rotLevelBlock } from "./content";

// ── Fragmented prompts ───────────────────────────────────────────────────────
// A prompt (persona or media-decider) can be stored in Firestore either as one
// monolithic `content` string (the legacy form, still the fallback) OR as an
// ordered list of named fragments under `fragments`. Fragments let us assemble
// the prompt from independently-addressable pieces — the scaffolding for letting
// a user later swap individual sections (their own slang, word bank, terms…).
//
// Today nothing is user-configurable: the fragments simply reassemble into the
// exact same prompt the monolithic string produced (verified byte-for-byte by
// the migration scripts). The only behavioral wins are the ones the emoji toggle
// already needed: drop the EMOJI section and use emoji-free example variants when
// the user turns emojis off.

// A single addressable piece of a prompt.
export type PromptFragment = {
  // Stable id, e.g. "voice_humor", "word_bank", "emoji". Lets a future config
  // layer target one fragment without re-sending the whole prompt.
  key: string;
  // The fragment's canonical text (the emoji-on / default form). Required unless
  // `dynamic` is set (then the text is computed at assembly time).
  text?: string;
  // Optional alternate text used when emojis are OFF. When absent, `text` is
  // used regardless of the emoji flag. Used for fragments whose examples contain
  // emoji (e.g. the factual-lookup sample) so an emoji-off turn stays clean.
  textWhenEmojisOff?: string;
  // Gate: include this fragment only when the named condition holds. "emojis" →
  // included only when respondWithEmojis is true (so the dedicated EMOJI section
  // disappears entirely when emojis are off). Absent = always included.
  requires?: "emojis";
  // Computed fragment: ignore `text` and resolve in code at assembly time.
  // "rot_level_block" → rotLevelBlock(level, emojisEnabled).
  dynamic?: "rot_level_block";
};

export type FragmentedPrompt = {
  // Bumped when the fragment schema/shape changes so a reader can reject an
  // unexpected version and fall back to `content`.
  fragmentsVersion: number;
  // Separator joining adjacent fragments. The section layout used a single blank
  // line between sections, so this is "\n\n" — stored explicitly so assembly is
  // never implicit.
  joinWith: string;
  fragments: PromptFragment[];
};

export type AssembleCtx = {
  // Active Rot Level (1–3) — only consumed by the dynamic rot_level_block.
  level: number;
  // Whether emojis are enabled this turn. Drives conditional fragments and the
  // emoji-off text variants. The media-decider path passes true (it's unaffected
  // by the user's emoji toggle).
  emojisEnabled: boolean;
};

// Resolves one fragment to its final text for this turn, or null when the
// fragment is gated out (e.g. the EMOJI section with emojis off).
function resolveFragment(f: PromptFragment, ctx: AssembleCtx): string | null {
  if (f.requires === "emojis" && !ctx.emojisEnabled) return null;
  if (f.dynamic === "rot_level_block") {
    return rotLevelBlock(ctx.level, ctx.emojisEnabled);
  }
  if (!ctx.emojisEnabled && typeof f.textWhenEmojisOff === "string") {
    return f.textWhenEmojisOff;
  }
  return f.text ?? "";
}

// Assembles the fragmented prompt for this turn: drops gated-out fragments,
// resolves dynamic/variant text, and joins the survivors with `joinWith`.
// Pure and deterministic given the inputs.
export function assembleFragments(fp: FragmentedPrompt, ctx: AssembleCtx): string {
  const parts: string[] = [];
  for (const f of fp.fragments) {
    const text = resolveFragment(f, ctx);
    if (text !== null) parts.push(text);
  }
  return parts.join(fp.joinWith);
}

// Validates a candidate `fragments` payload read off a Firestore doc. Anything
// malformed returns false so the caller can safely fall back to the monolithic
// `content` string — a bad/partial migration can never break prompt assembly.
export function asFragmentedPrompt(value: unknown): FragmentedPrompt | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.fragmentsVersion !== "number") return null;
  if (typeof v.joinWith !== "string") return null;
  if (!Array.isArray(v.fragments) || v.fragments.length === 0) return null;
  for (const raw of v.fragments) {
    if (!raw || typeof raw !== "object") return null;
    const f = raw as Record<string, unknown>;
    if (typeof f.key !== "string" || f.key.length === 0) return null;
    const isDynamic = typeof f.dynamic === "string";
    if (!isDynamic && typeof f.text !== "string") return null;
    if (f.textWhenEmojisOff != null && typeof f.textWhenEmojisOff !== "string") {
      return null;
    }
    if (f.requires != null && f.requires !== "emojis") return null;
    if (f.dynamic != null && f.dynamic !== "rot_level_block") return null;
  }
  return value as FragmentedPrompt;
}
