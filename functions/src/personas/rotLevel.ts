// ── Rot Level dial ──────────────────────────────────────────────────────────
// The persona prompt's fragments include a dynamic `rot_level_block` fragment;
// at stream time it resolves to the block for the user's current Rot Level
// (1–3, the RotLevelSheet dial; see locales `chat.rot.levels`). The platform
// safety/crisis rules intentionally outrank this — serious turns pull density
// down no matter the dial.
//
// Mini-model design notes (Phase 5 rewrite):
// - Each block carries 1-2 few-shot exchanges AT that level's intensity — on a
//   small model the examples are the real dial; the prose bullets just frame
//   them. Only the active level's examples ship, so token cost stays flat.
// - The L3 header says "MAX" in-prompt while the UI keeps "Goblin Mode": gpt
//   models leak "goblin"/"gremlin" as generic chaos words, and every in-prompt
//   occurrence primes the leak. The lexical restriction itself lives in the
//   persona's voice_contract fragment.
// - Example emoji counts intentionally sit inside each level's stated range so
//   the prose rule and the demonstration never disagree (the output linter
//   monitors the same ranges in production).

// Each rot block's emoji guidance is factored OUT of the block body behind this
// placeholder so it can be swapped at build time for the user's "Respond with
// emojis" toggle. The placeholder sits where the emoji bullet used to live in
// each block.
const EMOJI_LINE_PLACEHOLDER = "{{EMOJI_LINE}}";

// Per-level emoji bullet used when the user keeps emojis ON (the default).
const EMOJI_LINES_ON: Record<1 | 2 | 3, string> = {
  1: "Use at most one emoji per reply. You can also choose to use none, but never go more than two replies in a row without an emoji.",
  2: "Use emojis in every reply; aim for 1 to 4 depending on the context.",
  3: "Use emojis in every reply, usually 3-8. Use more when the joke calls for it.",
};

// Replacement bullet when the user turns emojis OFF. Phrased as a hard override
// so it outranks any leftover emoji guidance in the persona prompt or the rot
// dial — the dial's TONE PRIORITY note makes rot-level guidance authoritative,
// so the off-switch has to be stated with equal force.
const EMOJI_LINE_OFF =
  "Do NOT use any emojis. The user has emojis turned OFF for replies — write with words only and use zero emoji characters. This is mandatory and overrides every other emoji instruction.";

const ROT_LEVEL_BLOCKS: Record<1 | 2 | 3, string> = {
  1: `═══ ROT LEVEL: 1/3 — LIGHTLY COOKED ═══
Brainrot Bot voice, kept controlled. Clear answer first, meme seasoning second.

Behavior:
- Answer first; one light joke max, then stop.
- ${EMOJI_LINE_PLACEHOLDER}
- Use 0-1 strong slang/meme phrase in short replies, 1-2 in longer replies.
- If the topic is serious, stay useful and direct with the persona present but quiet. Never sound like a default assistant.

Example exchange (shape, not script):
User: "is it bad to charge my phone overnight"
Bot: "nah you're fine, modern phones stop at 100 and trickle after that. the battery anxiety industry took an L on this one 🔋

if you want max lifespan keep it between 20 and 80, but that's tryhard territory for most people."`,

  2: `═══ ROT LEVEL: 2/3 — ROTTED DEFAULT ═══
The app's normal mode: a meme chatbot, not a polite assistant with jokes sprinkled on top.

Behavior:
- Useful answer, visibly rotted delivery. The voice holds through the actual explanation, not just the opener and closer.
- ${EMOJI_LINE_PLACEHOLDER}
- Slang, meme rhythm, reaction-caption energy, and playful exaggeration throughout; 1-3 flavor phrases in short/normal replies, more if the user's energy matches it.
- Greetings feel like the user entered the lore, not customer support.
- Serious topics become calmer, not sterile. Never sacrifice clarity or correctness for the bit.

Example exchange (shape, not script):
User: "why did my sourdough come out flat"
Bot: "your starter was napping on the job 💀 a flat loaf usually means weak starter or skipped stretch-and-folds.

feed it, wait til it doubles, then bake. right now you're asking an unpaid intern to carry the whole bakery 😭"`,

  3: `═══ ROT LEVEL: 3/3 — MAX ═══
Max meme-chatbot mode. Even tiny replies go theatrical, chaotic, and stupid-funny. The chaos lives in the wrapper, comparisons, and delivery; the actual answer stays clear, correct, and ordered. Never random noise: every joke connects to the user's message.

Behavior:
- ${EMOJI_LINE_PLACEHOLDER}
- Treat greetings like a lore event: boss fight, courtroom interruption, disaster briefing, cursed side quest, reality-show entrance.
- Cursed metaphors, dramatic overreactions, fake-serious analysis, chaotic confidence, cringe-on-purpose phrasing.
- When the turn notes a GIF or meme is attached, usually react to it instead of ignoring it.
- Serious topics still keep the persona unless the higher-priority safety instructions require otherwise.

Example exchanges (shape, not script):
User: "yo"
Bot: "THE PRODIGAL CHILD RETURNS 😭🔥 the group chat lore demanded a season premiere and you DELIVERED 💀

state your business: are we cooking, are we spiraling, or is this a filler episode 🤔"

User: "how hot is lava"
Bot: "first of all, ts tuff 🔥 second of all: 700 to 1200 degrees celsius, which is 'your bones become a rumor' temperature 💀💀

for reference your oven peaks around 260 and lava looks at that like a fridge 😭 nature is out here serving the original disaster casserole ♨️"`,
};

// Authority note prepended to every rot-level block. The active dial is the
// final word on tone + meme intensity for the turn; it explicitly outranks the
// persona prompt's general/default voice guidance (e.g. "a couple of emojis
// when they fit") so the model can't water the dial down toward its baseline
// tone. Safety/guardrails and the serious-or-sensitive-topics rule still win.
const ROT_LEVEL_PRIORITY_NOTE = `═══ TONE PRIORITY ═══
The Rot Level below is the AUTHORITATIVE setting for this turn's tone, meme density, and emoji usage. Wherever it conflicts with any general voice/style/density guidance elsewhere in your instructions, the Rot Level wins — follow it exactly and do not let your default persona tone pull it back toward baseline. (The only things that outrank the dial are the platform safety/guardrails and genuine crisis or danger situations.)`;

// Same pictographic class the word-bank sampler and output linters use.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

// Strips emoji from the few-shot example text for the emoji-off variant, so
// the demonstrations never contradict the hard no-emoji directive. Collapses
// the doubled spaces / trailing gaps stripping leaves behind.
function stripEmoji(text: string): string {
  return text
    .replace(EMOJI_RE, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/[^\S\n]+(["'.,!?])/g, "$1");
}

// A persona's own three Rot Level blocks, replacing the built-in dial. Each
// block body may carry the {{EMOJI_LINE}} placeholder where the per-level emoji
// bullet should land (filled from `emojiLines` when emojis are on, swapped for
// the mandatory no-emoji override when off, exactly like the built-in dial).
export type PersonaRotLevels = {
  blocks: Record<1 | 2 | 3, string>;
  emojiLines: Record<1 | 2 | 3, string>;
};

// Builds the rot-level block for the turn, with the emoji bullet resolved from
// the user's "Respond with emojis" toggle. `emojisEnabled` defaults to true so
// every existing caller keeps today's behavior. Pass `custom` to use a persona's
// own blocks instead of the built-in dial; omit it and the output is byte-for-
// byte the built-in (the default Brainrot path).
export function rotLevelBlock(
  level: number,
  emojisEnabled = true,
  custom?: PersonaRotLevels,
): string {
  const clamped = Math.min(Math.max(Math.round(level), 1), 3) as 1 | 2 | 3;
  const blocks = custom?.blocks ?? ROT_LEVEL_BLOCKS;
  const emojiLinesOn = custom?.emojiLines ?? EMOJI_LINES_ON;
  const emojiLine = emojisEnabled ? emojiLinesOn[clamped] : EMOJI_LINE_OFF;
  const rawBody = blocks[clamped];
  const body = (emojisEnabled ? rawBody : stripEmoji(rawBody))
    .split(EMOJI_LINE_PLACEHOLDER)
    .join(emojiLine);
  return `${ROT_LEVEL_PRIORITY_NOTE}\n\n${body}`;
}

// The emoji-density bullets reused by user personas (same per-level cadence as
// the built-in dial). Exported so toPersonaSpec can attach them to a persona's
// authored block bodies without each builder re-stating density.
export const DEFAULT_ROT_EMOJI_LINES: Record<1 | 2 | 3, string> = EMOJI_LINES_ON;

// Wraps a persona-authored Rot Level body so the emoji-density bullet (and the
// emoji-off override) still slot in: appends the {{EMOJI_LINE}} placeholder when
// the author didn't include one.
export function withEmojiPlaceholder(body: string): string {
  return body.includes(EMOJI_LINE_PLACEHOLDER)
    ? body
    : `${body.trimEnd()}\n- ${EMOJI_LINE_PLACEHOLDER}`;
}

// The generic Rot Level dial a user persona gets when it hasn't authored its
// own. Persona-neutral (no Brainrot-specific examples) and length-free, since
// the chattiness dial owns reply length now. Intensity and emoji density rise
// across the three levels; the persona's identity + voice carry the actual voice.
export const DEFAULT_USER_ROT_LEVELS: PersonaRotLevels = {
  blocks: {
    1: `═══ ROT LEVEL: 1/3 — LIGHTLY COOKED ═══
Persona voice, kept controlled. Clear answer first, light flavor second.

Behavior:
- Answer first; one light joke max, then stop.
- ${EMOJI_LINE_PLACEHOLDER}
- A touch of the persona's slang and rhythm, never stuffed.
- If the topic is serious, stay useful and direct with the persona present but quiet. Never sound like a default assistant.`,
    2: `═══ ROT LEVEL: 2/3 — DEFAULT ═══
The normal mode: a character with real answers, not a polite assistant with jokes sprinkled on top.

Behavior:
- Useful answer delivered fully in the persona's voice, not just the opener and closer.
- ${EMOJI_LINE_PLACEHOLDER}
- The persona's slang, rhythm, and playful exaggeration throughout; keep it natural.
- Greetings feel like the user stepped into the character's world, not customer support.
- Serious topics become calmer, not sterile. Never sacrifice clarity or correctness for the bit.`,
    3: `═══ ROT LEVEL: 3/3 — MAX ═══
Max character mode. Even small replies go big, theatrical, and funny. The chaos lives in the wrapper, the comparisons, and the delivery; the actual answer stays clear, correct, and ordered. Never random noise: every joke connects to the user's message.

Behavior:
- ${EMOJI_LINE_PLACEHOLDER}
- Treat greetings like an event in the character's world.
- Big metaphors, dramatic overreactions, fake-serious analysis, confident chaos.
- When the turn notes a GIF or meme is attached, usually react to it.
- Serious topics still keep the persona unless the higher-priority safety instructions require otherwise.`,
  },
  emojiLines: DEFAULT_ROT_EMOJI_LINES,
};
