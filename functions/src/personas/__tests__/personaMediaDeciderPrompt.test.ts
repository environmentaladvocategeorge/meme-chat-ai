/// <reference types="jest" />
import { asFragmentedPrompt, assembleFragments } from "../fragments";
import {
  PERSONA_MEDIA_DECIDER_FRAGMENTS,
  PERSONA_MEDIA_DECIDER_KEY,
  PERSONA_MEDIA_DECIDER_VERSION,
} from "../personaMediaDeciderPrompt";
import { renderPersonaPromptDoc } from "../personaSpec";
import { toPersonaSpec, type UserPersonaInput } from "../userPersonas";

// Layer-1 validation for the user-persona media decider: assemble the canonical
// fragments exactly the way buildMediaDeciderPrompt does and assert on the
// composed string. Zero API and zero Firestore calls. The live Firestore doc is
// written from these same fragments by scripts/push-persona-media-decider.cjs,
// so green here means the pushed prompt is well-formed too.
//
// This decider drives off the PERSONA's favorite searches (their picked pills),
// NOT the brainrot bank — that's the whole point of the split. The brainrot
// decider (mediaDeciderPrompt.ts) keeps the bank + brainrot rung; this one drops
// both and treats the persona's favorites as the primary query pool.

const body = assembleFragments(PERSONA_MEDIA_DECIDER_FRAGMENTS, {
  level: 3,
  emojisEnabled: true,
});

describe("persona media decider prompt", () => {
  it("is a valid FragmentedPrompt that Firestore readers will accept", () => {
    expect(asFragmentedPrompt(PERSONA_MEDIA_DECIDER_FRAGMENTS)).not.toBeNull();
    expect(PERSONA_MEDIA_DECIDER_VERSION).toBe("v2");
    expect(PERSONA_MEDIA_DECIDER_KEY).toBe("media_decider_persona");
  });

  it("frames the turn as a custom, user-built persona", () => {
    expect(body).toContain("CUSTOM PERSONA");
    expect(body).toContain("THIS PERSONA'S MEDIA");
    expect(body).toContain("source of truth");
  });

  it("rung 3 grants permission to pick SIMILAR/on-theme media, not just exact favorites", () => {
    expect(body).toContain("DRAW FROM THIS PERSONA'S MEDIA");
    expect(body).toContain("not a fixed menu");
    expect(body).toContain("SAME theme/vibe");
    expect(body).toContain("out-of-context is fine because it's the creator's preference");
  });

  it("carries NO reaction bank in the body (it's conditional, in the per-persona tail)", () => {
    // The body is generic + cached; the bank only appears in renderMediaNotes
    // when the creator delegated. So the static body never names bank rows.
    expect(body).not.toContain("FALLBACK BANK");
    expect(body).not.toContain("greeting:");
    expect(body).not.toContain("Kermit waving");
  });

  it("drops the brainrot rung and any brainrot terms entirely", () => {
    expect(body.toLowerCase()).not.toContain("brainrot");
    expect(body).not.toContain("PURE BRAINROT REQUEST");
    expect(body).not.toContain("tung tung tung sahur");
    expect(body).not.toContain("skibidi");
  });

  it("reuses the shared decision machinery (attach policy, randomness, output)", () => {
    expect(body).toContain("ATTACH OR NOT");
    expect(body).toContain("RANDOMNESS_FACTOR (1-30)");
    expect(body).toContain("FROZEN");
    expect(body).toContain("REPEAT RULE");
    expect(body).toContain('{"type":"none"|"gif"|"meme"');
  });

  it("keeps the crisis carve-out", () => {
    expect(body).toContain('ALWAYS return "none"');
  });

  it("carries the image-description rung (rung 2)", () => {
    expect(body).toContain("DESCRIBE IT");
    expect(body).toContain("crying dog meme");
  });

  it("does not carry its own rot line — that fragment is dynamic (deciderRotLine)", () => {
    expect(body).not.toContain("Current rot level");
  });
});

// ── Fake-persona end-to-end prompt evaluation ────────────────────────────────
// Build a real UserPersonaInput, render it the way savePersona does, then
// assemble the FULL decider prompt body + the persona's media notes — exactly
// what a chat turn sends the model (minus the Firestore-resolved guardrails
// prefix + the rot line, both asserted elsewhere). Proves the prompt reflects
// the user's picks: WHICH gifs they chose, or "let the bot decide" when they
// didn't.

function baseInput(): UserPersonaInput {
  return {
    displayName: "Gym Bro Greg",
    identity: "A hype gym bro who turns every win into a PR celebration.",
    voiceExample: { user: "i'm tired", good: "rest is part of the grind bro, we go again tmrw" },
    greetingShapes: ["yo lets get it", "gym time?"],
    humorTypes: ["hype", "deadpan"],
    humorExampleShapes: ["we don't miss leg day in this house"],
    emojiPalette: ["💪", "🔥"],
    publicConfig: { shortDescription: "Gym hype energy", toneTags: ["hype"] },
  };
}

// Mirrors buildMediaDeciderPrompt's dynamic tail (sans the rot line): the persona
// media notes ride AFTER the shared body. publicConfig grounds the note's
// identity line (one-liner + tone tags), exactly as savePersona passes it.
function assembleWithNotes(input: UserPersonaInput): string {
  const spec = toPersonaSpec("user_test_abcd", input);
  const doc = renderPersonaPromptDoc(spec, input.publicConfig);
  return doc.mediaNotes ? `${body}\n\n${doc.mediaNotes}` : body;
}

describe("fake persona → assembled decider prompt reflects the user's picks", () => {
  // SCENARIO A: picked favorites, did NOT delegate (auto off). Favorites + "or
  // similar" only — NO fallback bank at all.
  it("favorites + no auto: favorites and on-theme grounding, and NO fallback bank", () => {
    const prompt = assembleWithNotes({
      ...baseInput(),
      media: {
        pills: ["Mega Knight: Time for Jim", "Gigachad Man in Black and White"],
        lean: "always sends gym gifs or memes",
      },
    });
    expect(prompt).toContain("THIS PERSONA'S MEDIA");
    // Identity grounding so "similar" is meaningful.
    expect(prompt).toContain(`This bot is "Gym Bro Greg" — Gym hype energy.`);
    expect(prompt).toContain("Vibe: hype.");
    // The picked searches are present and framed as lead-with-these + similar.
    expect(prompt).toContain(`"Mega Knight: Time for Jim"`);
    expect(prompt).toContain(`"Gigachad Man in Black and White"`);
    expect(prompt).toContain("SIMILAR in theme/vibe");
    expect(prompt).toContain("Media cadence: always sends gym gifs or memes.");
    // No bank, no brainrot, no old "vibe only" framing.
    expect(prompt).not.toContain("Elmo wave");
    expect(prompt).not.toContain("choose any reaction that suits the turn");
    expect(prompt.toLowerCase()).not.toContain("brainrot");
    expect(prompt).not.toContain("vibe only — every rule above still wins");
  });

  // SCENARIO B: picked favorites AND delegated (auto on). Favorites + similar,
  // PLUS the fallback bank as a free-choice safety net.
  it("favorites + auto: favorites AND the fallback bank both appear", () => {
    const prompt = assembleWithNotes({
      ...baseInput(),
      media: { pills: ["Mega Knight: Time for Jim"], auto: true },
    });
    expect(prompt).toContain(`"Mega Knight: Time for Jim"`);
    expect(prompt).toContain("lets it pick reactions freely");
    expect(prompt).toContain("- greeting: Elmo wave"); // bank present
  });

  // SCENARIO C: no favorites, delegated (auto on). Free-choice + bank, no
  // favorites line.
  it("no favorites + auto: free-choice + bank, no favorites line", () => {
    const prompt = assembleWithNotes({ ...baseInput(), media: { auto: true } });
    expect(prompt).toContain("THIS PERSONA'S MEDIA");
    expect(prompt).toContain("lets it pick reactions freely");
    expect(prompt).toContain("- greeting: Elmo wave"); // bank present
    expect(prompt).not.toContain("Favorite reaction searches"); // no pills
  });

  it("a persona with no media config gets the body only (no notes tail)", () => {
    const prompt = assembleWithNotes(baseInput());
    // No dynamic media tail is appended — the prompt is exactly the shared body.
    // (The body's rung 3 still REFERENCES "THIS PERSONA'S MEDIA"; what's absent
    // is the rendered favorites/bank note that tail would carry.)
    expect(prompt).toBe(body);
    expect(prompt).not.toContain("Favorite reaction searches");
    expect(prompt).not.toContain("lets it pick reactions freely");
  });
});
