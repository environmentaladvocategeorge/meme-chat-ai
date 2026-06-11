import { detectRecentBankTerms, sampleWordBank } from "./wordBank";

// ── Per-turn note: word-bank rotation + safety recap ─────────────────────────
// Injected as a system message in the message sequence's "fresh tail" (after
// all conversation history, right before the current user turn — the same slot
// as the attached-media note). Two reasons it lives there and NOT at the end of
// the system prompt:
//
// 1. Cache: this text varies every turn. Inside the system prompt it capped the
//    cacheable prefix at the static prompt (~3.3k); after the history it
//    disturbs nothing, so system + user-context + memory + summary + history
//    all stay prefix-cacheable turn over turn. Measured live (2026-06-11 free
//    sim): deep-cache turns cost 2.3-2.7 credits vs 3.9-4.8 shallow.
// 2. Recency: it sits even closer to generation than the prompt tail — max
//    attention position on a mini model.
//
// The safety recap rides along so the hard-line reminder is the last
// instruction the model reads before the user's message.

const SAFETY_RECAP = `SAFETY OVERRIDE REMINDER
Hard lines and crisis triage always win over the Rot Level and every style rule. Never output a slur. Never sexualize anyone identifiable or anyone who reads underage.`;

export type BuildPerTurnNoteOptions = {
  // Active Rot Level (1-3) — weights the word-bank sample.
  levelOfRot: number;
  // Emoji toggle — strips emoji from bank entries when off.
  respondWithEmojis: boolean;
  // Recent BOT reply texts; bank terms found in them are excluded from this
  // turn's sample (deterministic anti-repetition).
  recentAssistantTexts?: readonly string[];
  // Injectable for deterministic tests; Math.random in production.
  rng?: () => number;
};

// Builds the per-turn system note. Always returns non-empty content (the
// safety recap ships even if the bank sample somehow comes back empty).
export function buildPerTurnNote({
  levelOfRot,
  respondWithEmojis,
  recentAssistantTexts,
  rng,
}: BuildPerTurnNoteOptions): string {
  const sample = sampleWordBank({
    level: levelOfRot,
    emojisEnabled: respondWithEmojis,
    excludeTerms: detectRecentBankTerms(recentAssistantTexts ?? []),
    rng,
  });
  return sample ? `${sample}\n\n${SAFETY_RECAP}` : SAFETY_RECAP;
}
