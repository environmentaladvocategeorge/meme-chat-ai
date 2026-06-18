import type { FragmentedPrompt, PromptFragment } from "./fragments";
import type { PersonaRotLevels } from "./rotLevel";

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
  // The builder let the bot send media on its own ("allow it to send its own
  // GIFs", mirroring autoGreet). Adds a note nudging the decider to attach
  // freely and not stick to preset searches. Vibe only — rules/safety still win.
  auto?: boolean;
};

export type PersonaSpec = {
  // Persona doc id this spec renders for, e.g. "brainrot_bot_default".
  id: string;
  // Display name as referenced in prose ("Brainrot Bot"); the intro header
  // renders it uppercased.
  displayName: string;
  // The identity/vibe paragraph — who this persona is, in 1-3 sentences.
  identity: string;
  // The voice-contract few-shot pair (the primary example, paired with the
  // seeded "bad" report-mode example).
  voiceExample: PersonaVoiceExample;
  // Extra user-authored positive examples (up to a few), rendered after the
  // primary as additional "User / Good" pairs. Absent/empty = just the primary.
  voiceExtraExamples?: { user: string; good: string }[];
  // Optional house-authored lexical patch rendered inside the voice contract
  // (e.g. Brainrot Bot's goblin/gremlin leak rule). Not exposed to user
  // builders — user personas get structured neverSays rendering later.
  lexicalRule?: string;
  // Optional signature behavior appended to the HOW YOU TEXT rules (e.g. the
  // single-brainrot-sentence party trick). One sentence, same paragraph.
  signatureMove?: string;
  // Reply-length dial (1 = curt … 5 = chatty). Drives the bubble-count wording
  // in the chat frame and HOW YOU TEXT. Absent renders as stage 3, which is
  // byte-identical to the original fixed wording, so existing specs are unchanged.
  chattiness?: number;
  // The persona's own three Rot Level blocks. Absent → the built-in dial (the
  // default Brainrot behavior), so an existing spec renders identically.
  rotLevels?: PersonaRotLevels;
  // Greeting example shapes, rendered quoted and "/"-joined. May be empty when
  // autoGreet is on (the persona is told to improvise its own greetings).
  greetingShapes: string[];
  // When true, the greeting section invites the persona to write its own
  // greetings (in addition to any shapes provided), instead of only riffing on
  // the listed shapes.
  autoGreet?: boolean;
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

// Chattiness presets (1 = curt … 5 = chatty). Each stage varies only the
// reply-length wording; the chat-bubble frame and "split by line breaks" stay
// fixed. Stage 3 is the default and reproduces the original sentences VERBATIM,
// so a spec with no chattiness renders byte-for-byte as before.
type ChattinessCopy = {
  // Goes into the chat frame: "You write the reply: <jobReply>. Nothing else."
  jobReply: string;
  // Goes into HOW YOU TEXT: "Chat bubbles, not articles: <textChunks>."
  textChunks: string;
};

const CHATTINESS_DEFAULT = 3;

const CHATTINESS: Record<1 | 2 | 3 | 4 | 5, ChattinessCopy> = {
  1: {
    jobReply: "usually one short plain-text chat bubble, two at most, split by line breaks",
    textChunks:
      "one short chunk, two at most, split by line breaks, usually a single line each; never pad to fill space",
  },
  2: {
    jobReply: "1-2 short plain-text chat bubbles split by line breaks",
    textChunks: "1-2 short chunks split by line breaks, usually one sentence each",
  },
  3: {
    jobReply: "1-4 short plain-text chat bubbles split by line breaks",
    textChunks: "1-4 short chunks split by line breaks, usually 1-2 sentences each",
  },
  4: {
    jobReply: "1-5 short plain-text chat bubbles split by line breaks",
    textChunks: "1-5 short chunks split by line breaks, usually 1-3 sentences each",
  },
  5: {
    jobReply:
      "several short plain-text chat bubbles split by line breaks, more when the moment calls for it",
    textChunks:
      "several short chunks split by line breaks; it can run longer when the moment fits, still split into readable chunks, never one wall of text",
  },
};

function chattinessCopy(spec: PersonaSpec): ChattinessCopy {
  const n = spec.chattiness;
  const stage = (
    typeof n === "number" && n >= 1 && n <= 5 ? Math.round(n) : CHATTINESS_DEFAULT
  ) as 1 | 2 | 3 | 4 | 5;
  return CHATTINESS[stage];
}

function personaIntro(spec: PersonaSpec): string {
  const { jobReply } = chattinessCopy(spec);
  return `PERSONA: ${spec.displayName.toUpperCase()}

${spec.identity}

THE JOB: you receive one user chat message, sometimes with a system note that a reaction GIF/meme is attached. You write the reply: ${jobReply}. Nothing else.

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
  // Additional user-authored examples reinforce the voice without re-stating the
  // bad/report contrast (the primary already carries it).
  for (const ex of spec.voiceExtraExamples ?? []) {
    paragraphs.push(`User: "${ex.user}"`, `Good (voice held):\n"${ex.good}"`);
  }
  return paragraphs.join("\n\n");
}

// The list rule lives HERE and only here — never state a list rule in two
// fragments; a mini model averages a nuanced rule and a blanket ban into
// "sometimes lists".
function howYouText(spec: PersonaSpec): string {
  const signature = spec.signatureMove ? ` ${spec.signatureMove}` : "";
  const { textChunks } = chattinessCopy(spec);
  return `HOW YOU TEXT

Chat bubbles, not articles: ${textChunks}. No walls of text. Plain text by default: no headings in casual chat, bold/italics rarely, code in code blocks. Bullets/numbered lists only when the user asks for steps, options, a checklist, comparison, or code; explaining alone is not a reason to list.${signature}`;
}

const ROASTING = `ROASTING

Roasting is allowed within the instructions above. Cook choices, vibes, outfits, habits, screenshots, code, lore, staging, lighting, props, captions, and absurd situations. No disclaimer, no "safe version." Anchor to what the user gave you.`;

function greetings(spec: PersonaSpec): string {
  const shapes = spec.greetingShapes.map((s) => `"${s}"`).join(" / ");
  // How the greeting guidance reads depends on what the builder provided:
  // shapes only (riff on these), auto only (improvise your own), or both.
  let guidance: string;
  if (spec.greetingShapes.length === 0) {
    guidance = "No fixed shapes here: write your own greetings in voice, fresh each time.";
  } else if (spec.autoGreet) {
    guidance = `You can riff on these shapes or write your own greetings in voice: ${shapes}.`;
  } else {
    guidance = `Shapes, not scripts: ${shapes}.`;
  }
  return `GREETINGS / SMALL TALK

To hi/hey/yo/sup/wsg/gm/ayo: reply short, funny, open-ended, no feature menu. Follow the active Rot Level for intensity. ${guidance} Never "Hello! How can I assist you today?" If the user asks for less or more brainrot, acknowledge and match when allowed.`;
}

function voiceHumor(spec: PersonaSpec): string {
  const types = spec.humorTypes.join(", ");
  // Skipped humor ("let the model decide"): no authored types, so the persona
  // leans on its own judgment. When types ARE present this is byte-identical to
  // the original "Humor types: …" sentence.
  const humorLine = types
    ? `Humor types: ${types}.`
    : `Lean on your own sense of humor, fit to your character.`;
  // The example-shapes block drops out entirely when none were authored.
  const shapesBlock =
    spec.humorExampleShapes.length > 0
      ? `\n\nExample shapes:\n${spec.humorExampleShapes.map((s) => `"${s}"`).join("\n")}`
      : "";
  return `VOICE / HUMOR

Don't sound like customer support, LinkedIn, a school essay, a brand mascot, or fast-food Twitter. No fake hype ("what's poppin", "let's get this party started", "fellow kids").

${humorLine} Callbacks are elite: bring back the user's earlier phrasing, escalate a running bit across the conversation, quote their own words back at them. Jokes always connect to the user's message, never random.${shapesBlock}

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
      // Emoji section drops out entirely when the persona has no palette (now
      // optional for user personas) — the gate only governs the runtime on/off.
      ...(spec.emojiPalette.length > 0
        ? [renderStaticFragment("emoji", emoji(spec), "emojis")]
        : []),
      ...(spec.houseExtras ?? []),
      // The persona's own dial when it has one; otherwise the bare dynamic
      // fragment resolves to the built-in dial (unchanged default behavior).
      spec.rotLevels
        ? {
            key: "rot_level_block",
            dynamic: "rot_level_block" as const,
            rotLevels: spec.rotLevels,
          }
        : { key: "rot_level_block", dynamic: "rot_level_block" as const },
    ],
  };
}

// The trimmed generic reaction bank, emitted into the media note ONLY when the
// creator let the bot choose freely (media.auto). For a persona that picked its
// own favorites, this never appears — the creator's picks (and on-theme similar
// searches) are the whole pool. No brainrot row (that's the brainrot decider's).
const PERSONA_FALLBACK_BANK = [
  "- greeting: Elmo wave, SpongeBob hi, Kermit waving, jim carrey hello",
  "- shock: shocked Pikachu, confused Math Lady, turtle shook",
  "- judging: Gordon Ramsay disappointed, Squidward judging, side eye monkey",
  "- W / hype: massive W, LeBron celebration, gigachad, mic drop",
  "- nope / evasive: Michael Scott no, Evil Kermit",
  "- tired / over it: SpongeBob tired, this is fine dog, no thoughts head empty",
  "- sad-cope (jokey, NOT real grief): crying cat, sad corner",
  "- petty / roast: Kermit sipping tea, mocking SpongeBob, side eye Chloe",
  "- laughing: crying laughing cat, ryan gosling laughing",
  "- chaos / panic: SpongeBob panic, dramatic chipmunk, dramatic realization",
].join("\n");

// Word-bank terms are vocabulary, not search terms — a handful is plenty of
// thematic grounding for the decider; the full bank (≤40) would just bloat the
// note for a mini model.
const MEDIA_NOTE_WORD_BANK_CAP = 15;

// Identity bits the media note borrows from the persona's public config (not on
// the spec) so "pick something SIMILAR" is grounded in who the bot is.
type MediaNotePublicConfig = {
  shortDescription?: string;
  toneTags?: string[];
};

// Renders the per-persona media note that rides AFTER the shared decider body
// (buildMediaDeciderPrompt appends it), or null when the persona has no media
// config at all (the brainrot path — keeps its doc fragments-only, untouched).
//
// This note carries EVERYTHING persona-specific the decider needs, because the
// shared body is intentionally generic: the bot's name + one-liner (+ optional
// vibe/humor/words) ground what "similar" means, then the creator's favorites,
// then — ONLY when the creator let the bot choose freely (auto) — the generic
// fallback bank. A persona that picked favorites and did NOT delegate gets NO
// bank: its own picks (and on-theme similars) are the entire pool.
function renderMediaNotes(
  spec: PersonaSpec,
  publicConfig?: MediaNotePublicConfig,
): string | null {
  const media = spec.media;
  const pills = (media?.pills ?? []).filter((p) => p.trim().length > 0);
  const lean = media?.lean?.trim();
  const auto = media?.auto === true;
  // No media config → no media note (brainrot and any media-less persona).
  if (pills.length === 0 && !lean && !auto) return null;

  const lines = [
    `THIS PERSONA'S MEDIA — the creator's own preferences for this custom bot (the safety/none rules above still win)`,
  ];

  // Context first, so the favorites/similar instruction below is grounded.
  const oneLiner = publicConfig?.shortDescription?.trim();
  lines.push(
    oneLiner
      ? `This bot is "${spec.displayName}" — ${oneLiner}.`
      : `This bot is "${spec.displayName}".`,
  );
  const tone = (publicConfig?.toneTags ?? []).filter((t) => t.trim().length > 0);
  if (tone.length > 0) lines.push(`Vibe: ${tone.join(", ")}.`);
  if (spec.humorTypes.length > 0) lines.push(`Humor: ${spec.humorTypes.join(", ")}.`);
  const words = (spec.wordBank ?? [])
    .filter((w) => w.trim().length > 0)
    .slice(0, MEDIA_NOTE_WORD_BANK_CAP);
  if (words.length > 0) lines.push(`Words it leans on: ${words.join(", ")}.`);
  if (lean) lines.push(`Media cadence: ${lean}.`);

  if (pills.length > 0) {
    const quoted = pills.map((p) => `"${p.trim()}"`).join(", ");
    lines.push(
      `Favorite reaction searches — lead with these, and you may also pick any meme/GIF SIMILAR in theme/vibe that fits the turn; rotate, never force one: ${quoted}.`,
    );
  }
  if (auto) {
    lines.push(
      `This bot's creator lets it pick reactions freely — when nothing persona-specific fits, choose any reaction that suits the turn, from these sparks or your own meme knowledge:\n${PERSONA_FALLBACK_BANK}`,
    );
  }
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

export function renderPersonaPromptDoc(
  spec: PersonaSpec,
  // The persona's public config, for the media note's identity grounding
  // (one-liner + tone tags, which live on publicConfig, not the spec). Optional
  // so media-less callers (brainrot) and tests render exactly as before.
  publicConfig?: MediaNotePublicConfig,
): RenderedPersonaPromptDoc {
  const doc: RenderedPersonaPromptDoc = {
    fragments: renderPersonaPrompt(spec),
  };
  const deciderKey = spec.media?.deciderKey?.trim();
  if (deciderKey) doc.mediaDeciderKey = deciderKey;
  const mediaNotes = renderMediaNotes(spec, publicConfig);
  if (mediaNotes) doc.mediaNotes = mediaNotes;
  return doc;
}
