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

describe("media decider prompt v7", () => {
  it("is a valid FragmentedPrompt that Firestore readers will accept", () => {
    expect(asFragmentedPrompt(MEDIA_DECIDER_FRAGMENTS)).not.toBeNull();
    expect(MEDIA_DECIDER_VERSION).toBe("v7");
  });

  it("spotlights the current trending meme (scuba), usable out of context and as a greeting", () => {
    // The headline trend is scuba, not the old sidetalk nyc.
    expect(assembled).toContain("TRENDING");
    expect(assembled).toContain("scuba");
    expect(assembled).toContain("tung tung scuba");
    expect(assembled).toContain("greeting/hello reaction");
    // scuba is in the greeting row so it's a live pick for hellos.
    const bank = MEDIA_DECIDER_FRAGMENTS.fragments.find((f) => f.key === "reaction_bank");
    expect(bank?.text).toContain("greeting:");
    expect(bank?.text).toContain("scuba cat");
  });

  it("keeps sidetalk nyc as a permanent bank entry, no longer the headline trend", () => {
    const bank = MEDIA_DECIDER_FRAGMENTS.fragments.find((f) => f.key === "reaction_bank");
    expect(bank?.text).toContain("sidetalk nyc");
    // It moved into the W/hype row, not the TRENDING line.
    expect(bank?.text).not.toContain('"sidetalk nyc" on');
  });

  it("rotates the greeting row: fresh terms up front, Elmo wave / SpongeBob hi at the end", () => {
    const row = assembled.split("\n").find((l) => l.startsWith("- greeting:")) ?? "";
    expect(row).toContain("hey you");
    expect(row).toContain("whats good");
    expect(row).toContain("elmo door");
    // The two old leads are demoted to the back of the row.
    expect(row.indexOf("hey you")).toBeLessThan(row.indexOf("Elmo wave"));
    expect(row.trimEnd().endsWith("SpongeBob hi")).toBe(true);
  });

  it("carries the lighter US 'also popular' pick (Love Island USA)", () => {
    expect(assembled).toContain("Love Island USA");
  });

  it("has the react-to-attachment rung (rung 2), never echo", () => {
    expect(assembled).toContain("NEVER ECHO THE USER'S OWN ATTACHMENT");
    expect(assembled).toContain("REACT TO IT, NEVER COPY IT");
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

  it("includes image few-shot examples that react instead of echoing", () => {
    expect(assembled).toContain("the user SENT a dramatically crying dog");
    expect(assembled).toContain("the user SENT shocked Pikachu");
    expect(assembled).toContain("react, never copy");
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
    expect(DECIDER_CALL_CONFIG.model).toBe(resolveModelId("gpt-5.4-mini"));
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

  it("restates the never-echo rule at the point of decision", () => {
    const text = imageTurnText();
    expect(text).toContain("REACTING to it");
    expect(text).toContain("not handing it back");
  });

  it("targets the echo failure mode directly", () => {
    expect(imageTurnText()).toContain(
      "NEVER make your query the same named meme/character/subject shown",
    );
  });
});
