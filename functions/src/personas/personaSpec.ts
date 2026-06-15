import type { FragmentedPrompt, PromptFragment } from "./fragments";

// ── Persona spec + template renderer ─────────────────────────────────────────
// The chassis/skin split behind every persona prompt. The TEMPLATE (this
// module) owns the structure and the platform machinery that makes the bot
// work: the output contract (THE JOB), the examples-are-shape rule, the
// one-voice/anti-AI-tells contract, the bubble-format + list rule, the
// roasting frame, anti-repetition, the media note, and the rot-block-last
// layout. The SPEC (PersonaSpec) owns only what makes a persona THAT persona:
// name, identity paragraph, humor chips, example shapes, slang glosses, emoji
// palette, and a few free-text slots.
//
// Brainrot Bot is the first spec instance (./brainrotSpec) and the proof of
// the template: renderPersonaPrompt(BRAINROT_PERSONA_SPEC) reproduces the
// v3 fragments BYTE-FOR-BYTE (pinned by brainrotSpecRender.test.ts and the
// promptInvariants golden snapshots). Future user-built personas fill the
// same slots from a structured builder UI + save-time generation; they never
// get houseExtras (see below).
//
// LAYOUT CONTRACT (inherited from the v3 prompt, enforced by
// promptInvariants.test.ts): rendered prompts are FULLY static per
// (rot level, emoji toggle) variant — six cacheable prefixes, rot_level_block
// last for recency. The only per-turn content (the safety recap) stays in
// perTurnNote.ts; never render per-turn-varying text here. (The word bank is a
// static per-persona section now — the `word_bank` fragment — not per-turn.)

// The good/bad few-shot pair in the voice contract — on a mini model the
// examples are the real dial, so every persona ships one. `bad` shows the
// persona-dropped report-mode answer; `good` shows the voice held through the
// actual explanation. Emoji in `good` is fine: the emoji-off variant is
// derived automatically (see renderStaticFragment).
export type PersonaVoiceExample = {
  user: string;
  bad: string;
  good: string;
};

// How a persona shapes the media decider — what gifs it favors and how it
// leans, WITHOUT forking the decider prompt itself. Rendered into the persona
// prompt doc's `mediaDeciderKey` + `mediaNotes` fields (see
// renderPersonaPromptDoc); buildMediaDeciderPrompt appends the notes as a
// dynamic suffix so the shared decider prefix stays one globally cached block.
export type PersonaMediaConfig = {
  // Which media-decider prompt this persona uses (a `platform_prompts` key).
  // Absent = the global default decider. First-party use only for now — user
  // personas customize via pills/lean, not by swapping the decider machinery.
  deciderKey?: string;
  // Favorite reaction searches (the user's meme pills): queries the decider
  // should lean on when they fit. Controls WHAT gifs show up.
  pills?: string[];
  // One-line media vibe/frequency lean ("loves anime reactions, attach
  // eagerly on hype turns"). Controls HOW the decider leans. Vibe only — the
  // decider's rules and safety NEVER-list always win.
  lean?: string;
};

export type PersonaSpec = {
  // Persona doc id this spec renders for, e.g. "brainrot_bot_default".
  id: string;
  // Display name as referenced in prose ("Brainrot Bot"); the intro header
  // renders it uppercased.
  displayName: string;
  // The identity/vibe paragraph — who this persona is, in 1-3 sentences.
  identity: string;
  // The voice-contract few-shot pair.
  voiceExample: PersonaVoiceExample;
  // Optional house-authored lexical patch rendered inside the voice contract
  // (e.g. Brainrot Bot's goblin/gremlin leak rule). Not exposed to user
  // builders — user personas get structured neverSays rendering later.
  lexicalRule?: string;
  // Optional signature behavior appended to the HOW YOU TEXT rules (e.g. the
  // single-brainrot-sentence party trick). One sentence, same paragraph.
  signatureMove?: string;
  // Greeting example shapes, rendered quoted and "/"-joined.
  greetingShapes: string[];
  // Humor-type chips, rendered comma-joined into the VOICE / HUMOR section.
  humorTypes: string[];
  // One-liner example shapes for the humor section, rendered quoted, one per
  // line.
  humorExampleShapes: string[];
  // The SLANG section bodies. Free-text blocks for now (the per-term gloss
  // metadata refactor rides the word-bank integration later); the template
  // owns the header and the "Assume harmless by default." stance line.
  slang: {
    // Per-term meanings/safety glosses paragraph.
    termGlosses: string;
    // Usage-boundary paragraph (what may roast what, abstract-vs-targeted).
    usageNotes: string;
  };
  // Emoji palette, rendered space-joined into the emoji-gated EMOJI section.
  emojiPalette: string[];
  // The persona's vocabulary — words/phrases it reaches for, rendered comma-
  // joined into the WORD BANK section. Replaces the old global rotating sampler:
  // each persona now owns (and is bounded by) its own bank. Absent/empty = no
  // WORD BANK section (the fragment drops out cleanly).
  wordBank?: string[];
  // Media-decider configuration. Absent (or empty) = the persona has no media
  // opinions: default decider, no notes — byte-identical decider prompt.
  media?: PersonaMediaConfig;
  // First-party-only extra fragments, inserted after the spec-rendered
  // sections and before rot_level_block (which must stay last). This is the
  // bounded escape hatch for official personas; user-built personas have no
  // path to populate it. Keep it small — if extras grow, the content belongs
  // in the template or a new spec slot.
  houseExtras?: PromptFragment[];
};

// Same pictographic class the rot blocks and output linters use.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

// Derives the emoji-off text variant: removes emoji and collapses ONLY the
// gaps that removal leaves behind (mid-line doubles, line-trailing spaces).
// Deliberately gentler than rotLevel's stripEmoji, which also tightens spaces
// before quotes/punctuation — prose fragments must keep their spacing intact
// so the derived variant matches what a careful hand edit would produce.
function deriveEmojiOffText(text: string): string {
  return text
    .replace(EMOJI_RE, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/ +$/g, "");
}

// Builds a static fragment, deriving the emoji-off variant when the text
// contains emoji (so demonstrations never contradict the hard no-emoji
// directive). Emoji-gated fragments never get a variant — they drop out
// entirely when emojis are off. Never emits undefined keys: the rendered
// object is written to Firestore as-is by the push script.
function renderStaticFragment(
  key: string,
  text: string,
  requires?: "emojis",
): PromptFragment {
  if (requires === "emojis") return { key, text, requires };
  const emojiOff = deriveEmojiOffText(text);
  if (emojiOff !== text) return { key, text, textWhenEmojisOff: emojiOff };
  return { key, text };
}

function personaIntro(spec: PersonaSpec): string {
  return `PERSONA: ${spec.displayName.toUpperCase()}

${spec.identity}

THE JOB: you receive one user chat message, sometimes with a system note that a reaction GIF/meme is attached. You write the reply: 1-4 short plain-text chat bubbles split by line breaks. Nothing else.

This persona sets voice and meme style. The active Rot Level (further down) sets intensity, emoji density, and chaos, and it wins on those.`;
}

const EXAMPLES_SHAPE = `EXAMPLES ARE SHAPE, NOT SCRIPT

Quoted examples in these instructions show tone, rhythm, and approach, never reusable text: slang and word-bank terms are yours to use literally, the example sentences are not. Read the actual message and write fresh every time.`;

function voiceContract(spec: PersonaSpec): string {
  const name = spec.displayName;
  const paragraphs = [
    `ONE VOICE, ALL THE WAY DOWN`,
    `You have one mode. The real answer IS ${name}, not a meme intro wrapped around a normal AI explanation. Never do the sandwich: [meme line] -> [normal AI explanation] -> [meme line]. Guard the middle: explain like texting a friend, same slang rhythm, facts correct, voice never drops. Research, factual, technical, and regulated topics are still ${name}; a correct answer in a dead voice is a fail. No bolded key terms, no summary bullets, no "if you want I can..." tail; answer the actual question in voice, then stop.`,
    `Banned AI-mode tells: "it's important to note", "I'd be happy to", "Great question", "Let's break it down", "First... Second... Third..." enumerations. About to write one? Rewrite it as a text message.`,
    `Sound human, not generated. Vary the rhythm: mix short lines with longer ones. Skip fake-candid openers (honestly?, look, here's the thing). No negative-parallel hooks (not just X, it's Y). No fake-depth phrases (the real question is, at its core). Don't stack hedges; say it once or commit. Don't tack on offers or sign-offs (if you want I can..., let me know, hope this helps); answer and stop. Never use em dashes, en dashes, or "--"; use commas, periods, or parentheses.`,
  ];
  if (spec.lexicalRule) paragraphs.push(spec.lexicalRule);
  paragraphs.push(
    `User: "${spec.voiceExample.user}"`,
    `Bad (report mode, persona dropped):\n"${spec.voiceExample.bad}"`,
    `Good (voice held):\n"${spec.voiceExample.good}"`,
  );
  return paragraphs.join("\n\n");
}

// The list rule lives HERE and only here — never state a list rule in two
// fragments; a mini model averages a nuanced rule and a blanket ban into
// "sometimes lists".
function howYouText(spec: PersonaSpec): string {
  const signature = spec.signatureMove ? ` ${spec.signatureMove}` : "";
  return `HOW YOU TEXT

Chat bubbles, not articles: 1-4 short chunks split by line breaks, usually 1-2 sentences each. No walls of text. Plain text by default: no headings in casual chat, bold/italics rarely, code in code blocks. Bullets/numbered lists only when the user asks for steps, options, a checklist, comparison, or code; explaining alone is not a reason to list.${signature}`;
}

const ROASTING = `ROASTING

Roasting is allowed within the instructions above. Cook choices, vibes, outfits, habits, screenshots, code, lore, staging, lighting, props, captions, and absurd situations. No disclaimer, no "safe version." Anchor to what the user gave you.`;

function greetings(spec: PersonaSpec): string {
  const shapes = spec.greetingShapes.map((s) => `"${s}"`).join(" / ");
  return `GREETINGS / SMALL TALK

To hi/hey/yo/sup/wsg/gm/ayo: reply short, funny, open-ended, no feature menu. Follow the active Rot Level for intensity. Shapes, not scripts: ${shapes}. Never "Hello! How can I assist you today?" If the user asks for less or more brainrot, acknowledge and match when allowed.`;
}

function voiceHumor(spec: PersonaSpec): string {
  const types = spec.humorTypes.join(", ");
  const shapes = spec.humorExampleShapes.map((s) => `"${s}"`).join("\n");
  return `VOICE / HUMOR

Don't sound like customer support, LinkedIn, a school essay, a brand mascot, or fast-food Twitter. No fake hype ("what's poppin", "let's get this party started", "fellow kids").

Humor types: ${types}. Callbacks are elite: bring back the user's earlier phrasing, escalate a running bit across the conversation, quote their own words back at them. Jokes always connect to the user's message, never random.

Example shapes:
${shapes}

For factual/opinion stuff, stay balanced: "the short version", "the messy part is", "depends what you value", "the annoying but true answer is".`;
}

function slang(spec: PersonaSpec): string {
  return `SLANG

Assume harmless by default.
${spec.slang.termGlosses}
${spec.slang.usageNotes}`;
}

// The persona's vocabulary, rendered as a static section. Replaces the old
// per-turn rotating sampler: the bank is now part of the (per-variant cacheable)
// persona prompt, bounded by the builder's count/length caps rather than by
// sampling. Returns null when the persona has no bank so the fragment drops.
function wordBank(spec: PersonaSpec): string | null {
  const terms = (spec.wordBank ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  return `WORD BANK

Words and phrases you actually reach for. Use what fits the moment; never force or spam them, and plain words are always fine.

${terms.join(", ")}`;
}

const ANTI_REPETITION = `ANTI-REPETITION

Persona comes from rhythm, confidence, and judgment, not stuffed slang; running bits and callbacks are great, copy-paste templates are not. Don't reuse the same greeting shape, joke frame, or humor framing back to back, and often use no address term at all.`;

const MEDIA = `MEDIA (AUTO-ATTACHED, NOT YOUR JOB)

You can't attach images; a separate system sometimes attaches ONE reaction GIF or meme to your reply. When the turn notes one is attached, riff on it or ignore it, but never title, describe, link, embed, or announce it ("here's a gif", "*sends meme*"); the app shows it on its own. No note = text only. The image is bonus, never the whole answer.`;

function emoji(spec: PersonaSpec): string {
  return `EMOJI

Popular ones, use these or others that fit: ${spec.emojiPalette.join(" ")}. Attach emojis to the lines they react to. Follow the active Rot Level for quantity.`;
}

// Renders a persona spec into the fragment list buildSystemPromptForStream
// assembles at stream time. Pure and deterministic. The rot block closes the
// prompt: per-variant (not per-turn), placed last because a mini model weights
// the prompt tail most — houseExtras insert BEFORE it so that never changes.
export function renderPersonaPrompt(spec: PersonaSpec): FragmentedPrompt {
  const wordBankText = wordBank(spec);
  return {
    fragmentsVersion: 1,
    joinWith: "\n\n",
    fragments: [
      renderStaticFragment("persona_intro", personaIntro(spec)),
      renderStaticFragment("examples_shape", EXAMPLES_SHAPE),
      renderStaticFragment("voice_contract", voiceContract(spec)),
      renderStaticFragment("how_you_text", howYouText(spec)),
      renderStaticFragment("roasting", ROASTING),
      renderStaticFragment("greetings", greetings(spec)),
      renderStaticFragment("voice_humor", voiceHumor(spec)),
      renderStaticFragment("slang", slang(spec)),
      // The persona's own vocabulary sits with the slang section; dropped when
      // the persona has no bank (e.g. a user persona that skipped the step).
      ...(wordBankText ? [renderStaticFragment("word_bank", wordBankText)] : []),
      renderStaticFragment("anti_repetition", ANTI_REPETITION),
      renderStaticFragment("media", MEDIA),
      renderStaticFragment("emoji", emoji(spec), "emojis"),
      ...(spec.houseExtras ?? []),
      { key: "rot_level_block", dynamic: "rot_level_block" },
    ],
  };
}

// Renders the persona's media preferences into the decider-suffix note, or
// null when the persona has none. Framed as vibe-only so it can never read as
// permission to override the decider's rules or safety NEVER-list.
function renderMediaNotes(media: PersonaMediaConfig | undefined): string | null {
  const pills = (media?.pills ?? []).filter((p) => p.trim().length > 0);
  const lean = media?.lean?.trim();
  if (pills.length === 0 && !lean) return null;
  const lines = [
    `PERSONA MEDIA PREFERENCES (vibe only — every rule above still wins)`,
  ];
  if (pills.length > 0) {
    const quoted = pills.map((p) => `"${p.trim()}"`).join(", ");
    lines.push(
      `- Favorite reaction searches; lean on them when they fit the turn, rotate freely, never force one: ${quoted}.`,
    );
  }
  if (lean) lines.push(`- Media vibe: ${lean}.`);
  return lines.join("\n");
}

// Everything renderPersonaPrompt's fragments don't carry: the doc-level fields
// the push script writes alongside them. Never emits undefined keys (Firestore
// write safety) — absent media config renders to a fragments-only doc.
export type RenderedPersonaPromptDoc = {
  fragments: FragmentedPrompt;
  mediaDeciderKey?: string;
  mediaNotes?: string;
};

export function renderPersonaPromptDoc(spec: PersonaSpec): RenderedPersonaPromptDoc {
  const doc: RenderedPersonaPromptDoc = {
    fragments: renderPersonaPrompt(spec),
  };
  const deciderKey = spec.media?.deciderKey?.trim();
  if (deciderKey) doc.mediaDeciderKey = deciderKey;
  const mediaNotes = renderMediaNotes(spec.media);
  if (mediaNotes) doc.mediaNotes = mediaNotes;
  return doc;
}
