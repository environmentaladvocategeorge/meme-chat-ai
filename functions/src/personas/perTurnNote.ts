// ── Per-turn note: safety recap ──────────────────────────────────────────────
// Injected as a system message in the message sequence's "fresh tail" (after
// all conversation history, right before the current user turn — the same slot
// as the attached-media note), so the hard-line reminder is the last instruction
// the model reads before the user's message. It lives there (not at the end of
// the system prompt) so the static system + history prefix stays prefix-cacheable
// turn over turn.
//
// It used to also carry the rotating word-bank sample; that's gone — each persona
// now owns its word bank as a static section in its prompt (see personaSpec.ts
// `word_bank`), so there's nothing per-turn-varying to inject here besides safety.

export const SAFETY_RECAP = `SAFETY OVERRIDE REMINDER
Hard lines and crisis triage always win over the Rot Level and every style rule. Never output a slur. Never sexualize anyone identifiable or anyone who reads underage.`;

// The per-turn system note. A constant today (the safety recap); kept as a
// function so the fresh-tail call sites and assembly slot don't change if a
// future per-turn signal needs to ride here again.
export function buildPerTurnNote(): string {
  return SAFETY_RECAP;
}
