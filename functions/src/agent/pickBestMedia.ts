import { logger } from "firebase-functions";
import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import type { ModelUsage } from "../billing/ledger";
import { resolveModelId } from "../billing/models";

// ── "Look at the results and pick the best" step ─────────────────────────────
// After the decider chooses a search query and Klipy returns the ranked hits,
// this reads the candidate TITLES (text only — no vision, no images) and picks
// the single best one for the turn, instead of the blind front-biased random
// pick. It's the cheap half of the validated "looks & picks" design:
//   - nano, reasoning "none": choosing one number from a short list is trivial,
//     so it runs on the cheapest/fastest model and bills a rounding error.
//   - Title-only: Klipy titles are descriptive enough; reading the actual GIF
//     pixels would be slow + costly for no real gain.
//   - Never throws: any failure falls back to index 0 (the top-ranked hit), so
//     a hiccup degrades to today's behavior, never to no media.
// The CALLER owns the "lock on references" rule — it only passes this in for
// broad/generic queries (randomness_factor > 2); exact references keep the top
// hit with no extra call.

// gpt-5.4 accepts "none" at the API though the pinned SDK types omit it (same
// cast the media decider uses). Drop the cast when the SDK is bumped.
const PICK_REASONING_EFFORT = "none" as unknown as ReasoningEffort;

const ZERO_USAGE: ModelUsage = {
  model: "nano",
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

export async function pickBestMediaIndex(args: {
  apiKey: string;
  // The user's current turn text — what the pick should best react to.
  message: string;
  // Candidate result titles, best-ranked first (index 0 = Klipy's top hit).
  titles: string[];
  signal?: AbortSignal;
}): Promise<{ index: number; usage: ModelUsage }> {
  const { titles } = args;
  if (titles.length <= 1) return { index: 0, usage: ZERO_USAGE };

  try {
    const client = new OpenAI({ apiKey: args.apiKey });
    const numbered = titles
      .map((t, i) => `${i}. ${t || "(untitled)"}`)
      .join("\n");
    const completion = await client.chat.completions.create(
      {
        model: resolveModelId("nano"),
        reasoning_effort: PICK_REASONING_EFFORT,
        max_completion_tokens: 80,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "media_pick",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { index: { type: "integer" } },
              required: ["index"],
            },
          },
        },
        messages: [
          {
            role: "system",
            content:
              "You pick the single funniest, most on-point GIF/meme to react to the user's message, from a numbered list of result titles. Reply with the chosen index only.",
          },
          {
            role: "user",
            content: `User said: "${args.message.slice(0, 300)}"\n\nResults:\n${numbered}`,
          },
        ],
      },
      { signal: args.signal },
    );

    const u = completion.usage;
    const usage: ModelUsage = {
      model: "nano",
      inputTokens: u?.prompt_tokens ?? 0,
      cachedInputTokens:
        (u?.prompt_tokens_details as { cached_tokens?: number } | undefined)
          ?.cached_tokens ?? 0,
      outputTokens: u?.completion_tokens ?? 0,
      reasoningTokens:
        (u?.completion_tokens_details as { reasoning_tokens?: number } | undefined)
          ?.reasoning_tokens ?? 0,
    };

    let index = 0;
    try {
      index = Number(
        JSON.parse(completion.choices[0]?.message?.content ?? "{}").index,
      );
    } catch {
      index = 0;
    }
    if (!Number.isInteger(index) || index < 0 || index >= titles.length) {
      index = 0;
    }
    return { index, usage };
  } catch (err) {
    logger.warn("[pickBestMediaIndex] failed; using top hit", { err });
    return { index: 0, usage: ZERO_USAGE };
  }
}
