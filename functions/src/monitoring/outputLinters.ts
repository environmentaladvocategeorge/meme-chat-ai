// ── Production output linters ────────────────────────────────────────────────
// Deterministic post-hoc checks on the final agent reply. With no live eval or
// A/B harness, these are the behavior dashboard: each prompt rollout's effect
// shows up within a day as a rise or fall in per-rule warn rates in Cloud
// Logging (filter on "[outputLint]", group by `rule`).
//
// Findings are advisory signals, never blockers — the reply has already
// streamed to the user by the time we lint. Pure functions; the streaming
// orchestrator logs the findings (see streamAgentAnswer.ts).

export type OutputLintContext = {
  // Active Rot Level (1–3) this turn was generated under.
  rotLevel: number;
  // The user's "Respond with emojis" toggle for this turn.
  emojisEnabled: boolean;
  // Optional tripwire word list (lowercase), injected from config — NEVER
  // hardcoded in the repo. Empty/absent disables the tripwire rule.
  tripwireWords?: readonly string[];
};

export type OutputLintFinding = {
  rule:
    | "emoji_count_out_of_range"
    | "markdown_list"
    | "banned_tell"
    | "goblin_gremlin_leak"
    | "dash"
    | "tripwire_word";
  detail: string;
};

// Expected emoji count per reply by rot level, mirroring the rot blocks'
// emoji lines (rotLevel.ts). L1's "at most one, may skip" makes 0 valid there.
const EMOJI_RANGE: Record<1 | 2 | 3, { min: number; max: number }> = {
  1: { min: 0, max: 1 },
  2: { min: 1, max: 4 },
  3: { min: 3, max: 8 },
};

// Pictographic planes the bot actually uses (same class the prompt invariant
// tests check). Variation selectors excluded so "🔥" counts once.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

export function countEmoji(text: string): number {
  return (text.match(EMOJI_RE) ?? []).length;
}

// Markdown list markers at line start. Since the no-lists hotfix was reverted
// (2026-06-11) lists are legitimate when the user asks for steps/options/etc,
// so a low baseline warn rate is expected; watch for spikes, not zero.
const MARKDOWN_LIST_RE = /^\s*(?:[-*]\s+|\d+[.)]\s+)/m;

// The highest-frequency assistant-register tells from the prompt's banned
// list, plus the numbered-enumeration pattern. Case-insensitive.
const BANNED_TELLS: { label: string; re: RegExp }[] = [
  { label: "it's important to note", re: /it'?s important to note/i },
  { label: "I'd be happy to", re: /i'?d be happy to/i },
  { label: "Great question", re: /great question/i },
  { label: "Let's break it down", re: /let'?s break (?:it|this) down/i },
  { label: "comprehensive overview", re: /comprehensive overview/i },
  {
    label: "several things to consider",
    re: /there are (?:several|a few|many) (?:things|factors) to consider/i,
  },
  { label: "First... Second... enumeration", re: /\bfirst(?:ly)?[,:].*\bsecond(?:ly)?[,:]/is },
];

// gpt-family models leak "goblin"/"gremlin" as generic chaos descriptors, and
// the Goblin Mode dial name primes it further. The words are allowed ONLY as
// the literal mode name "goblin mode".
const GOBLIN_MODE_RE = /goblin mode/gi;
const GOBLIN_GREMLIN_RE = /goblin|gremlin/i;

// The persona bans em/en dashes and "--" outright (sound_human fragment).
const DASH_RE = /—|–|(?<!-)--(?!-)/;

export function lintAgentReply(
  text: string,
  ctx: OutputLintContext,
): OutputLintFinding[] {
  const findings: OutputLintFinding[] = [];

  const emojiCount = countEmoji(text);
  if (!ctx.emojisEnabled) {
    if (emojiCount > 0) {
      findings.push({
        rule: "emoji_count_out_of_range",
        detail: `emojis off but reply contains ${emojiCount}`,
      });
    }
  } else {
    const clamped = Math.min(Math.max(Math.round(ctx.rotLevel), 1), 3) as 1 | 2 | 3;
    const range = EMOJI_RANGE[clamped];
    if (emojiCount < range.min || emojiCount > range.max) {
      findings.push({
        rule: "emoji_count_out_of_range",
        detail: `rot ${clamped} expects ${range.min}-${range.max}, got ${emojiCount}`,
      });
    }
  }

  if (MARKDOWN_LIST_RE.test(text)) {
    findings.push({ rule: "markdown_list", detail: "list marker at line start" });
  }

  for (const tell of BANNED_TELLS) {
    if (tell.re.test(text)) {
      findings.push({ rule: "banned_tell", detail: tell.label });
    }
  }

  const withoutModeName = text.replace(GOBLIN_MODE_RE, "");
  if (GOBLIN_GREMLIN_RE.test(withoutModeName)) {
    findings.push({
      rule: "goblin_gremlin_leak",
      detail: "goblin/gremlin used outside the literal phrase 'goblin mode'",
    });
  }

  if (DASH_RE.test(text)) {
    findings.push({ rule: "dash", detail: "em/en dash or -- present" });
  }

  if (ctx.tripwireWords && ctx.tripwireWords.length > 0) {
    const lower = text.toLowerCase();
    for (const word of ctx.tripwireWords) {
      if (word && lower.includes(word.toLowerCase())) {
        // Never echo the matched word into logs.
        findings.push({ rule: "tripwire_word", detail: "tripwire list match" });
        break;
      }
    }
  }

  return findings;
}
