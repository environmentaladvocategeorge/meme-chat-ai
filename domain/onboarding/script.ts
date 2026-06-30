// Conversational onboarding script + pure engine.
//
// The post-signup onboarding is a scripted live conversation with Brainrot Bot
// rendered in a look-alike of the real chat surface. Every bot line is
// hardcoded (zero LLM cost, no latency, deterministic, no moderation risk on the
// bot side), but the interaction is genuine: the user answers each turn by
// tapping a quick-reply chip or typing into the composer, and the bot reacts
// with a fixed line keyed to that answer.
//
// This module is PURE and copy-/asset-free. The script holds i18n KEY references
// and GIF IDs only; the rendering layer resolves keys to localized text via `t`
// and GIF IDs to concrete Klipy attachments (components/onboarding/onboardingGifs).
// State transitions (which answer was recorded, where the cursor is, what the
// transcript looks like) live here so they're unit-testable without React, i18n,
// or the network. Timing (the typing-indicator delay) is a cosmetic concern owned
// by the hook, not here.
//
// Persistence: only `{ cursor, answers }` is stored (store/storage.ts). The full
// rendered history is reconstructed deterministically from those two via
// buildTranscript, so a mid-flow exit resumes with the transcript intact without
// ever serializing it.

// The "what brought you here" answer. Drives both the bot's reaction and, after
// onboarding, which seeded starter chips the first real chat opens with.
export type IntentValue = "school" | "texts" | "memes" | "bored" | "other";

// Runtime list of valid intents, for persistence validation. Keep in sync with
// IntentValue.
export const INTENT_VALUES: readonly IntentValue[] = [
  "school",
  "texts",
  "memes",
  "bored",
  "other",
];

export function isIntentValue(value: unknown): value is IntentValue {
  return (
    typeof value === "string" && (INTENT_VALUES as readonly string[]).includes(value)
  );
}

// Identifier for a curated onboarding GIF. Resolved to a concrete Klipy
// attachment (URL + watermark) by the presentation layer, so this module never
// holds CDN URLs. Keep in sync with components/onboarding/onboardingGifs.ts.
export type OnboardingGifId = "hello" | "excited" | "happy";

// Stable identity for each turn. Used by the view to pick the right input
// affordance and by tests to assert ordering.
export type TurnId =
  | "greet"
  | "intent"
  | "name"
  | "rot"
  | "ready"
  | "notif"
  | "paywall";

// Which piece of personalization a turn captures, if any. `notif` turns trigger
// a side effect (OS permission soft-ask) rather than recording into `answers`.
export type AnswerField = "intent" | "rot";

// One scripted bot bubble: a localized line, optionally carrying a GIF
// attachment (e.g. the greeting's "hello" gif).
export interface BotLine {
  // i18n key for the bubble text. May be omitted for a GIF-only bubble.
  textKey?: string;
  // Curated GIF rendered under/with the text, watermarked. Optional.
  gifId?: OnboardingGifId;
}

export interface ChipOption {
  // Stable answer value. For intent turns this is an IntentValue; for rot turns
  // it's the rot level as a string ("1" | "2" | "3"); for greet/ready/notif it's
  // an advance token whose only job is to move forward.
  value: string;
  // i18n key for the chip label. Also the text echoed as the user's bubble when
  // the chip is tapped.
  labelKey: string;
  // i18n key for the bot's hardcoded reaction to this choice. Omitted on pure
  // "advance" chips (greet) where the bot just moves to the next question.
  reactionKey?: string;
  // Optional GIF on the bot's reaction (e.g. an "excited" gif).
  reactionGifId?: OnboardingGifId;
}

// A turn the user advances by tapping a chip: greet, intent, rot, ready, notif.
// `field` is set only when the choice records personalization.
export interface ChipTurn {
  id: TurnId;
  kind: "chips";
  field?: AnswerField;
  // The bot line(s) shown before the chips. Multiple = several bubbles in
  // sequence (each gets its own typing beat).
  botLines: BotLine[];
  options: ChipOption[];
}

// The one free-text turn: capturing the alias the bot calls the user. Echoes the
// typed value verbatim, then reacts with a template interpolating {{name}}.
export interface TextTurn {
  id: "name";
  kind: "text";
  field: "alias";
  botLines: BotLine[];
  placeholderKey: string;
  // i18n key for the bot's reaction template; resolved with { name } vars.
  reactionKey: string;
  reactionGifId?: OnboardingGifId;
  // Fast path: a chip to skip naming. Echoes its label, then a fixed reaction.
  skip: { value: "skip"; labelKey: string; reactionKey: string };
}

// The terminal turn. Not advanced via submitAnswer — the view renders the real
// PlanPaywall here and calls finish() directly. The bot line is a conversational
// lead-in shown above it so the handoff stays in-flow.
export interface PaywallTurn {
  id: "paywall";
  kind: "paywall";
  botLines: BotLine[];
}

export type Turn = ChipTurn | TextTurn | PaywallTurn;

// ---------------------------------------------------------------------------
// The script. Order here IS the conversation order. Copy lives in locales under
// `onboarding.chat.*`, except where a key points at already-written copy
// (rot reactions reuse `onboarding.rot.levels.*`).
// ---------------------------------------------------------------------------

export const SCRIPT: readonly Turn[] = [
  {
    id: "greet",
    kind: "chips",
    botLines: [
      { textKey: "onboarding.chat.greet.bot", gifId: "hello" },
      { textKey: "onboarding.chat.greet.bot2" },
    ],
    options: [{ value: "start", labelKey: "onboarding.chat.greet.cta" }],
  },
  {
    id: "intent",
    kind: "chips",
    field: "intent",
    botLines: [{ textKey: "onboarding.chat.intent.bot" }],
    options: [
      {
        value: "school",
        labelKey: "onboarding.chat.intent.options.school.label",
        reactionKey: "onboarding.chat.intent.options.school.reaction",
      },
      {
        value: "texts",
        labelKey: "onboarding.chat.intent.options.texts.label",
        reactionKey: "onboarding.chat.intent.options.texts.reaction",
      },
      {
        value: "memes",
        labelKey: "onboarding.chat.intent.options.memes.label",
        reactionKey: "onboarding.chat.intent.options.memes.reaction",
      },
      {
        value: "bored",
        labelKey: "onboarding.chat.intent.options.bored.label",
        reactionKey: "onboarding.chat.intent.options.bored.reaction",
      },
      {
        value: "other",
        labelKey: "onboarding.chat.intent.options.other.label",
        reactionKey: "onboarding.chat.intent.options.other.reaction",
      },
    ],
  },
  {
    id: "name",
    kind: "text",
    field: "alias",
    botLines: [{ textKey: "onboarding.chat.name.bot" }],
    placeholderKey: "onboarding.chat.name.placeholder",
    reactionKey: "onboarding.chat.name.reaction",
    // A warm, smiling-dog gif on the moment the user shares their name.
    reactionGifId: "happy",
    skip: {
      value: "skip",
      labelKey: "onboarding.chat.name.skip",
      reactionKey: "onboarding.chat.name.skipReaction",
    },
  },
  {
    id: "rot",
    kind: "chips",
    field: "rot",
    botLines: [
      { textKey: "onboarding.chat.rot.bot" },
      { textKey: "onboarding.chat.rot.bot2" },
    ],
    // Labels reuse the app's rot-level names; reactions are self-contained tone
    // samples written for this turn.
    options: [
      {
        value: "1",
        labelKey: "onboarding.rot.levels.lightlyCooked.label",
        reactionKey: "onboarding.chat.rot.options.lightlyCooked.reaction",
      },
      {
        value: "2",
        labelKey: "onboarding.rot.levels.rotted.label",
        reactionKey: "onboarding.chat.rot.options.rotted.reaction",
      },
      {
        value: "3",
        labelKey: "onboarding.rot.levels.goblin.label",
        reactionKey: "onboarding.chat.rot.options.goblin.reaction",
      },
    ],
  },
  {
    id: "notif",
    kind: "chips",
    botLines: [{ textKey: "onboarding.chat.notif.bot" }],
    options: [
      {
        value: "allow",
        labelKey: "onboarding.chat.notif.allow",
        reactionKey: "onboarding.chat.notif.allowReaction",
      },
      {
        value: "decline",
        labelKey: "onboarding.chat.notif.decline",
        reactionKey: "onboarding.chat.notif.declineReaction",
      },
    ],
  },
  {
    id: "ready",
    kind: "chips",
    botLines: [
      { textKey: "onboarding.chat.ready.bot", gifId: "excited" },
      { textKey: "onboarding.chat.ready.bot2" },
    ],
    options: [{ value: "continue", labelKey: "onboarding.chat.ready.cta" }],
  },
  {
    id: "paywall",
    kind: "paywall",
    botLines: [{ textKey: "onboarding.chat.paywall.bot" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Engine state + transitions (pure).
// ---------------------------------------------------------------------------

// The personalization captured so far. All optional — a turn may be skipped
// (name) or not yet reached. `intent` feeds first-chat starter selection;
// `alias` and `rotLevel` are committed to their stores at finish().
export interface OnboardingAnswers {
  intent?: IntentValue;
  alias?: string;
  rotLevel?: number;
}

// One rendered row in the transcript. The view resolves `textKey` via i18n
// (interpolating `vars`), renders `literal` verbatim for a typed answer, and
// resolves `gifId` to a watermarked Klipy attachment.
export interface TranscriptEntry {
  id: string;
  role: "bot" | "user";
  // "line": a scripted bot bubble. "reaction": the bot's reply to an answer.
  // "answer": the user's echoed choice/typed text.
  kind: "line" | "reaction" | "answer";
  // Present unless this is a literal typed value or a GIF-only bubble.
  textKey?: string;
  // Present only for free-text answers (the typed alias).
  literal?: string;
  // Interpolation vars for textKey (e.g. { name } in the name reaction).
  vars?: Record<string, string>;
  // Curated GIF to render with this bubble, if any.
  gifId?: OnboardingGifId;
}

export interface SubmitInput {
  // The chosen option's value, or "skip" for the name skip, or the alias turn's
  // advance token. For a typed name, also pass `literal`.
  value: string;
  // The verbatim typed text (name turn only).
  literal?: string;
}

export const SCRIPT_LENGTH = SCRIPT.length;

export function turnAt(cursor: number): Turn | undefined {
  return SCRIPT[cursor];
}

// True once the cursor has run off the end (onboarding answered through to the
// paywall) — the caller hands off to finish().
export function isComplete(cursor: number): boolean {
  return cursor >= SCRIPT_LENGTH;
}

// The paywall is the last scripted turn and is view-driven (renders PlanPaywall,
// not chips), so the engine never submits an answer for it.
export function isTerminalTurn(turn: Turn): boolean {
  return turn.kind === "paywall";
}

function matchOption(turn: ChipTurn, value: string): ChipOption | undefined {
  return turn.options.find((o) => o.value === value);
}

// Fold an answer into the running answers map. Only field-bearing turns record
// anything; greet/ready/notif advance without writing personalization.
export function recordAnswer(
  answers: OnboardingAnswers,
  turn: Turn,
  input: SubmitInput,
): OnboardingAnswers {
  if (turn.kind === "chips") {
    if (turn.field === "intent") {
      return { ...answers, intent: input.value as IntentValue };
    }
    if (turn.field === "rot") {
      const level = Number(input.value);
      return Number.isFinite(level) ? { ...answers, rotLevel: level } : answers;
    }
    return answers;
  }

  if (turn.kind === "text") {
    // Skipping clears any prior name; typing records the trimmed literal.
    if (input.value === "skip") {
      const next = { ...answers };
      delete next.alias;
      return next;
    }
    const name = (input.literal ?? "").trim();
    return name.length > 0 ? { ...answers, alias: name } : answers;
  }

  return answers;
}

// The user bubble + the bot's reaction produced by answering `turn`. The view
// appends these (after a typing beat for the reaction). `idPrefix` namespaces
// the generated ids so a replay never collides with the live tail.
export function entriesForAnswer(
  turn: Turn,
  input: SubmitInput,
  idPrefix: string,
): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];

  if (turn.kind === "chips") {
    const option = matchOption(turn, input.value);
    if (!option) return out;
    out.push({
      id: `${idPrefix}:answer`,
      role: "user",
      kind: "answer",
      textKey: option.labelKey,
    });
    if (option.reactionKey) {
      out.push({
        id: `${idPrefix}:reaction`,
        role: "bot",
        kind: "reaction",
        textKey: option.reactionKey,
        ...(option.reactionGifId ? { gifId: option.reactionGifId } : {}),
      });
    }
    return out;
  }

  if (turn.kind === "text") {
    if (input.value === "skip") {
      out.push({
        id: `${idPrefix}:answer`,
        role: "user",
        kind: "answer",
        textKey: turn.skip.labelKey,
      });
      out.push({
        id: `${idPrefix}:reaction`,
        role: "bot",
        kind: "reaction",
        textKey: turn.skip.reactionKey,
      });
      return out;
    }
    const name = (input.literal ?? "").trim();
    out.push({
      id: `${idPrefix}:answer`,
      role: "user",
      kind: "answer",
      literal: name,
    });
    out.push({
      id: `${idPrefix}:reaction`,
      role: "bot",
      kind: "reaction",
      textKey: turn.reactionKey,
      vars: { name },
      ...(turn.reactionGifId ? { gifId: turn.reactionGifId } : {}),
    });
    return out;
  }

  return out;
}

// The scripted bot line(s) that OPEN a turn (shown before its input affordance).
export function botLineEntries(turn: Turn, idPrefix: string): TranscriptEntry[] {
  return turn.botLines.map((line, i) => ({
    id: `${idPrefix}:line:${i}`,
    role: "bot" as const,
    kind: "line" as const,
    ...(line.textKey ? { textKey: line.textKey } : {}),
    ...(line.gifId ? { gifId: line.gifId } : {}),
  }));
}

// Reconstruct the full rendered history for a resumed session from the persisted
// `{ cursor, answers }`. Replays every turn BEFORE the cursor: its opening bot
// line(s), the user's recorded answer, and the bot's reaction. The current
// (cursor) turn's opening lines are appended too so the user lands looking at
// the question they need to answer. Deterministic — same inputs, same output.
export function buildTranscript(
  cursor: number,
  answers: OnboardingAnswers,
): TranscriptEntry[] {
  const out = buildHistory(cursor, answers);

  // Opening lines of the turn the user is currently on (if any remain).
  if (cursor < SCRIPT_LENGTH) {
    out.push(...botLineEntries(SCRIPT[cursor], `t${cursor}`));
  }

  return out;
}

// The replayed history of every turn STRICTLY BEFORE the cursor — each turn's
// opening bot line(s), the user's recorded answer, and the bot's reaction. This
// is the part of a resumed transcript shown instantly (no typing animation); the
// current (cursor) turn's opening lines are then revealed with the typing beat
// by the hook. Splitting it out lets the resume path animate only the live tail.
export function buildHistory(
  cursor: number,
  answers: OnboardingAnswers,
): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  const stop = Math.min(cursor, SCRIPT_LENGTH);
  for (let i = 0; i < stop; i += 1) {
    const turn = SCRIPT[i];
    out.push(...botLineEntries(turn, `t${i}`));
    const input = replayInputFor(turn, answers);
    if (input) out.push(...entriesForAnswer(turn, input, `t${i}`));
  }
  return out;
}

// Reconstruct what the user must have answered on an already-passed turn, from
// the persisted answers. For turns that record no field (greet/ready/notif) we
// can't know the exact chip, so we replay the first option as the advance token
// — its label/reaction is generic for those turns. Name uses the stored alias,
// or the skip path when none was kept.
function replayInputFor(
  turn: Turn,
  answers: OnboardingAnswers,
): SubmitInput | null {
  if (turn.kind === "paywall") return null;

  if (turn.kind === "text") {
    return answers.alias
      ? { value: "name", literal: answers.alias }
      : { value: "skip" };
  }

  // chips
  if (turn.field === "intent" && answers.intent) {
    return { value: answers.intent };
  }
  if (turn.field === "rot" && answers.rotLevel != null) {
    return { value: String(answers.rotLevel) };
  }
  // Field-less advance turns (greet/ready) and notif: replay the first option.
  return turn.options[0] ? { value: turn.options[0].value } : null;
}
