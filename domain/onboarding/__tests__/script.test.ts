import {
  SCRIPT,
  SCRIPT_LENGTH,
  type ChipTurn,
  type IntentValue,
  type OnboardingAnswers,
  botLineEntries,
  buildTranscript,
  entriesForAnswer,
  isComplete,
  isTerminalTurn,
  recordAnswer,
  turnAt,
} from "@/domain/onboarding/script";

// ---------------------------------------------------------------------------
// Script integrity — guards the data so a future edit can't ship a turn that
// the engine/view can't drive.
// ---------------------------------------------------------------------------
describe("SCRIPT integrity", () => {
  it("opens with greet and ends with the paywall", () => {
    expect(SCRIPT[0].id).toBe("greet");
    expect(SCRIPT[SCRIPT_LENGTH - 1].id).toBe("paywall");
    expect(isTerminalTurn(SCRIPT[SCRIPT_LENGTH - 1])).toBe(true);
  });

  it("has exactly one paywall turn and it is last", () => {
    const paywalls = SCRIPT.filter((t) => t.kind === "paywall");
    expect(paywalls).toHaveLength(1);
    expect(SCRIPT.indexOf(paywalls[0])).toBe(SCRIPT_LENGTH - 1);
  });

  it("gives every turn at least one opening bot line", () => {
    for (const turn of SCRIPT) {
      expect(turn.botLines.length).toBeGreaterThan(0);
    }
  });

  it("gives every chip turn at least one option, each with a label", () => {
    for (const turn of SCRIPT) {
      if (turn.kind !== "chips") continue;
      expect(turn.options.length).toBeGreaterThan(0);
      for (const option of turn.options) {
        expect(option.value).toBeTruthy();
        expect(option.labelKey).toBeTruthy();
      }
    }
  });

  it("gives every QUESTION option a reaction (greet/ready are advance-only)", () => {
    for (const turn of SCRIPT) {
      if (turn.kind !== "chips") continue;
      const advanceOnly = turn.id === "greet" || turn.id === "ready";
      for (const option of turn.options) {
        if (advanceOnly) continue;
        expect(option.reactionKey).toBeTruthy();
      }
    }
  });

  it("maps the rot options to levels 1, 2, 3 in order", () => {
    const rot = SCRIPT.find((t) => t.id === "rot") as ChipTurn;
    expect(rot.field).toBe("rot");
    expect(rot.options.map((o) => o.value)).toEqual(["1", "2", "3"]);
  });

  it("covers every IntentValue exactly once on the intent turn", () => {
    const intent = SCRIPT.find((t) => t.id === "intent") as ChipTurn;
    const values = intent.options.map((o) => o.value).sort();
    const expected: IntentValue[] = [
      "bored",
      "memes",
      "other",
      "school",
      "texts",
    ];
    expect(values).toEqual(expected);
  });

  it("only references known gif ids", () => {
    const known = new Set(["hello", "excited", "happy"]);
    for (const turn of SCRIPT) {
      if (turn.kind === "text" && turn.reactionGifId) {
        expect(known.has(turn.reactionGifId)).toBe(true);
      }
    }
    for (const turn of SCRIPT) {
      for (const line of turn.botLines) {
        if (line.gifId) expect(known.has(line.gifId)).toBe(true);
      }
    }
  });
});

describe("turnAt / isComplete", () => {
  it("returns the turn at a cursor, undefined past the end", () => {
    expect(turnAt(0)?.id).toBe("greet");
    expect(turnAt(SCRIPT_LENGTH)).toBeUndefined();
  });

  it("is complete only once the cursor runs off the end", () => {
    expect(isComplete(0)).toBe(false);
    expect(isComplete(SCRIPT_LENGTH - 1)).toBe(false);
    expect(isComplete(SCRIPT_LENGTH)).toBe(true);
    expect(isComplete(SCRIPT_LENGTH + 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recordAnswer — personalization folding.
// ---------------------------------------------------------------------------
describe("recordAnswer", () => {
  const intentTurn = SCRIPT.find((t) => t.id === "intent")!;
  const rotTurn = SCRIPT.find((t) => t.id === "rot")!;
  const nameTurn = SCRIPT.find((t) => t.id === "name")!;
  const greetTurn = SCRIPT.find((t) => t.id === "greet")!;

  it("records the chosen intent", () => {
    const next = recordAnswer({}, intentTurn, { value: "school" });
    expect(next.intent).toBe("school");
  });

  it("records the rot level as a number", () => {
    const next = recordAnswer({}, rotTurn, { value: "3" });
    expect(next.rotLevel).toBe(3);
  });

  it("ignores a non-numeric rot value", () => {
    const next = recordAnswer({ rotLevel: 2 }, rotTurn, { value: "nope" });
    expect(next.rotLevel).toBe(2);
  });

  it("records a typed, trimmed alias", () => {
    const next = recordAnswer({}, nameTurn, {
      value: "name",
      literal: "  Jorge  ",
    });
    expect(next.alias).toBe("Jorge");
  });

  it("treats an empty/whitespace typed name as no-op (keeps prior)", () => {
    const next = recordAnswer({ alias: "old" }, nameTurn, {
      value: "name",
      literal: "   ",
    });
    expect(next.alias).toBe("old");
  });

  it("clears any prior alias when the name turn is skipped", () => {
    const next = recordAnswer({ alias: "old" }, nameTurn, { value: "skip" });
    expect(next.alias).toBeUndefined();
  });

  it("records nothing for an advance-only (field-less) turn", () => {
    const before: OnboardingAnswers = { intent: "memes" };
    const after = recordAnswer(before, greetTurn, { value: "start" });
    expect(after).toEqual(before);
  });

  it("does not mutate the input answers", () => {
    const before: OnboardingAnswers = {};
    recordAnswer(before, intentTurn, { value: "texts" });
    expect(before).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// entriesForAnswer — the user bubble + bot reaction.
// ---------------------------------------------------------------------------
describe("entriesForAnswer", () => {
  const intentTurn = SCRIPT.find((t) => t.id === "intent")!;
  const greetTurn = SCRIPT.find((t) => t.id === "greet")!;
  const nameTurn = SCRIPT.find((t) => t.id === "name")!;
  const readyTurn = SCRIPT.find((t) => t.id === "ready")!;

  it("emits a user answer + a bot reaction for a question chip", () => {
    const out = entriesForAnswer(intentTurn, { value: "memes" }, "t1");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: "user", kind: "answer" });
    expect(out[1]).toMatchObject({ role: "bot", kind: "reaction" });
    expect(out[1].textKey).toContain("memes");
  });

  it("emits only the user answer for an advance-only chip (no reaction)", () => {
    const out = entriesForAnswer(greetTurn, { value: "start" }, "t0");
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
  });

  it("returns nothing for an unknown chip value", () => {
    const out = entriesForAnswer(intentTurn, { value: "ghost" }, "t1");
    expect(out).toHaveLength(0);
  });

  it("echoes the typed name verbatim and interpolates it into the reaction", () => {
    const out = entriesForAnswer(
      nameTurn,
      { value: "name", literal: "Menace" },
      "t2",
    );
    expect(out[0]).toMatchObject({ role: "user", literal: "Menace" });
    expect(out[1].vars).toEqual({ name: "Menace" });
    // The name reaction carries the warm "happy" gif.
    expect(out[1].gifId).toBe("happy");
  });

  it("uses the skip label + skip reaction when the name is skipped", () => {
    const out = entriesForAnswer(nameTurn, { value: "skip" }, "t2");
    expect(out[0].textKey).toBe("onboarding.chat.name.skip");
    expect(out[1].textKey).toBe("onboarding.chat.name.skipReaction");
  });

  it("carries a reaction gif when the bot line defines one (ready)", () => {
    // The ready turn's celebratory bot LINE carries the excited gif (asserted in
    // botLineEntries below); here we confirm advance-only ready emits no reaction.
    const out = entriesForAnswer(readyTurn, { value: "continue" }, "t4");
    expect(out).toHaveLength(1);
  });
});

describe("botLineEntries", () => {
  it("maps a turn's bot lines to bot 'line' entries, carrying gif ids", () => {
    const greet = SCRIPT.find((t) => t.id === "greet")!;
    const out = botLineEntries(greet, "t0");
    expect(out.every((e) => e.role === "bot" && e.kind === "line")).toBe(true);
    // The greeting opens with the hello gif on its first bubble.
    expect(out[0].gifId).toBe("hello");
  });

  it("attaches the excited gif to the ready reveal line", () => {
    const ready = SCRIPT.find((t) => t.id === "ready")!;
    const out = botLineEntries(ready, "t4");
    expect(out.some((e) => e.gifId === "excited")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildTranscript — deterministic resume reconstruction.
// ---------------------------------------------------------------------------
describe("buildTranscript", () => {
  it("at cursor 0 shows only the greeting's opening lines", () => {
    const out = buildTranscript(0, {});
    expect(out.every((e) => e.id.startsWith("t0:line"))).toBe(true);
    expect(out.some((e) => e.role === "user")).toBe(false);
  });

  it("replays passed turns with their recorded answers, then the current question", () => {
    // User answered greet -> intent(school) -> name(Jorge); now on the rot turn.
    const answers: OnboardingAnswers = { intent: "school", alias: "Jorge" };
    const out = buildTranscript(3, answers);

    // The typed name is echoed verbatim somewhere in the history.
    expect(out.some((e) => e.literal === "Jorge")).toBe(true);
    // The intent reaction (school) is present.
    expect(out.some((e) => e.textKey?.includes("school"))).toBe(true);
    // It ends on the rot question's opening line (the current turn).
    const tail = out[out.length - 1];
    expect(tail.id.startsWith("t3:line")).toBe(true);
  });

  it("uses the skip path in replay when no alias was kept", () => {
    const out = buildTranscript(3, { intent: "bored" });
    expect(out.some((e) => e.textKey === "onboarding.chat.name.skip")).toBe(
      true,
    );
  });

  it("is deterministic — same inputs produce identical output", () => {
    const answers: OnboardingAnswers = { intent: "texts", rotLevel: 2 };
    expect(buildTranscript(5, answers)).toEqual(buildTranscript(5, answers));
  });

  it("clamps a cursor past the end and never throws", () => {
    expect(() => buildTranscript(SCRIPT_LENGTH + 3, {})).not.toThrow();
    const out = buildTranscript(SCRIPT_LENGTH + 3, { intent: "memes" });
    // No 'current turn' lines appended past the end.
    expect(out.some((e) => e.id.startsWith(`t${SCRIPT_LENGTH}`))).toBe(false);
  });
});
