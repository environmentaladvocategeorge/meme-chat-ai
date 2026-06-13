/// <reference types="jest" />
import {
  DECIDER_CALL_CONFIG,
  buildDeciderMessages,
} from "../../agent/decideMedia";
import { resolveModelId } from "../../billing/models";
import { asFragmentedPrompt, assembleFragments } from "../fragments";
import { MEDIA_DECIDER_FRAGMENTS, MEDIA_DECIDER_VERSION } from "../mediaDeciderPrompt";

// Layer-1 validation for the v5 decider (randomness overhaul, no cold-start):
// assemble the canonical fragments exactly the way buildMediaDeciderPrompt
// does and assert on the composed string. Zero API and zero Firestore calls —
// this catches fragment-wiring mistakes (the most likely failure) before a
// push. The live Firestore doc is written from these same fragments by
// scripts/push-media-decider.cjs, so green here means the pushed prompt is
// well-formed too.

const assembled = assembleFragments(MEDIA_DECIDER_FRAGMENTS, {
  level: 3,
  emojisEnabled: true,
});

describe("media decider prompt v5.1", () => {
  it("is a valid FragmentedPrompt that Firestore readers will accept", () => {
    expect(asFragmentedPrompt(MEDIA_DECIDER_FRAGMENTS)).not.toBeNull();
    expect(MEDIA_DECIDER_VERSION).toBe("v5.1");
  });

  it("has the image-description rung (rung 2)", () => {
    expect(assembled).toContain("DESCRIBE IT");
    expect(assembled).toContain("crying dog meme");
  });

  it("is one ladder, first match wins", () => {
    expect(assembled).toContain("first match wins");
  });

  it("randomness guidance lives in ONE section, on the 1-30 scale", () => {
    expect(assembled).toContain("RANDOMNESS_FACTOR (1-30)");
    // The frozen-search-engine rationale the whole overhaul hangs on.
    expect(assembled).toContain("FROZEN");
    expect(assembled).toContain("SAME ranked results");
    // The ladder no longer carries its own factor values (single authority —
    // a mini model averages two competing scales into mush).
    const ladder = MEDIA_DECIDER_FRAGMENTS.fragments.find(
      (f) => f.key === "query_ladder",
    );
    expect(ladder?.text).not.toContain("randomness_factor");
  });

  it("carries the repeat rule (same query + same randomness = same GIF)", () => {
    expect(assembled).toContain("REPEAT RULE");
    expect(assembled).toContain("Same query + same randomness");
  });

  it("cold-start machinery is fully gone — greetings are a free pick", () => {
    expect(assembled).not.toContain("[cold-start:");
    expect(assembled).not.toContain("treat as binding");
    expect(assembled).toContain("pick freely across the greeting row");
  });

  it("keeps the crisis carve-out in the attach policy", () => {
    expect(assembled).toContain('ALWAYS return "none"');
  });

  it("includes image few-shot examples (textual stand-ins)", () => {
    expect(assembled).toContain("[GIF frames: dog crying dramatically, no text]");
    expect(assembled).toContain("[GIF frames: clearly the shocked Pikachu format]");
  });

  it("examples demonstrate the deep bands: chaos at 30, generic words mid-teens", () => {
    expect(assembled).toContain('"random brainrot","randomness_factor":30');
    expect(assembled).toContain('"handshake","randomness_factor":18');
  });

  it("does not carry its own rot line — that fragment is dynamic (deciderRotLine)", () => {
    expect(assembled).not.toContain("Current rot level");
  });
});

describe("decider model config (Decision A)", () => {
  it("resolves to the mini model string", () => {
    expect(DECIDER_CALL_CONFIG.model).toBe(resolveModelId("mini"));
    expect(DECIDER_CALL_CONFIG.model).toBe("gpt-5.4-mini");
  });
});

describe("image-turn template (Decision C)", () => {
  function imageTurnText(): string {
    const msgs = buildDeciderMessages({
      systemPrompt: "SYS",
      history: "",
      currentMessage: "[user sent a GIF]",
      imageUrls: ["data:image/png;base64,xxx"],
    });
    const content = msgs[msgs.length - 1].content;
    if (!Array.isArray(content)) throw new Error("expected content parts");
    const textPart = content.find((p) => p.type === "text");
    if (!textPart || textPart.type !== "text") throw new Error("no text part");
    return textPart.text;
  }

  it("restates ladder rungs 1-2 at the point of decision", () => {
    const text = imageTurnText();
    expect(text).toContain("ladder rung 1");
    expect(text).toContain("ladder rung 2");
    expect(text).toContain("crying dog meme");
  });

  it("targets the observed failure mode directly", () => {
    expect(imageTurnText()).toContain("never on what the frames make YOU feel");
  });
});
