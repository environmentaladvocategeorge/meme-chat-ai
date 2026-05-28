import { isMiniFamily } from "../models";
import { PLANS, PLAN_IDS, type PlanId } from "../plans";
import { type Classification, chooseModel, classifyRequest } from "../router";

describe("classifyRequest", () => {
  const cases: Array<[string, Classification]> = [
    ["hi", "easy"],
    ["hello!", "easy"],
    ["thanks", "easy"],
    ["ok", "easy"],
    ["lol", "easy"],
    ["what's up", "easy"],
    ["write me a python function that does X", "hard"],
    ["explain how transformers work in detail", "hard"],
    ["debug this code", "hard"],
    ["analyze the tradeoffs", "hard"],
    ["compare these two approaches", "hard"],
    ["why does my for loop crash", "hard"],
    ["```\nprint('hi')\n```", "hard"],
    ["a".repeat(700), "hard"],
    ["What is the capital of France?", "medium"],
    ["Tell me a joke", "easy"], // short, no hard-keyword, no question mark — cost-optimize to cheap
  ];

  it.each(cases)("classifies %j as %s", (input, expected) => {
    expect(classifyRequest(input)).toBe(expected);
  });
});

describe("chooseModel — invariants across the cartesian product", () => {
  it("only returns models in the plan's allowedModels", () => {
    for (const plan of PLAN_IDS) {
      for (const classification of ["easy", "medium", "hard"] as const) {
        for (const advanced of [false, true]) {
          for (const advancedCreditsUsed of [0, 9999]) {
            const m = chooseModel({ plan, classification, advanced, advancedCreditsUsed });
            expect(PLANS[plan].allowedModels).toContain(m);
          }
        }
      }
    }
  });

  it("free + advanced=true never returns a *-mini model", () => {
    for (const classification of ["easy", "medium", "hard"] as const) {
      const m = chooseModel({
        plan: "free",
        classification,
        advanced: true,
        advancedCreditsUsed: 0,
      });
      expect(isMiniFamily(m)).toBe(false);
    }
  });

  it("basic + advanced=true never returns a *-mini model (advancedMode disabled)", () => {
    for (const classification of ["easy", "medium", "hard"] as const) {
      const m = chooseModel({
        plan: "basic",
        classification,
        advanced: true,
        advancedCreditsUsed: 0,
      });
      expect(isMiniFamily(m)).toBe(false);
    }
  });

  it("plus + advanced=true + headroom returns smart-mini for hard requests", () => {
    const m = chooseModel({
      plan: "plus",
      classification: "hard",
      advanced: true,
      advancedCreditsUsed: 0,
    });
    expect(m).toBe("smart-mini");
  });

  it("plus + advanced=true + cap exhausted falls back to non-mini", () => {
    const m = chooseModel({
      plan: "plus",
      classification: "hard",
      advanced: true,
      advancedCreditsUsed: PLANS.plus.advancedMonthlyCreditCap,
    });
    expect(isMiniFamily(m)).toBe(false);
  });

  it("easy requests pick the cheapest available candidate", () => {
    const plans: PlanId[] = ["free", "basic", "plus", "power"];
    for (const plan of plans) {
      const m = chooseModel({
        plan,
        classification: "easy",
        advanced: false,
        advancedCreditsUsed: 0,
      });
      expect(m).toBe("nano");
    }
  });

  it("medium requests pick the plan default when reachable", () => {
    expect(
      chooseModel({
        plan: "basic",
        classification: "medium",
        advanced: false,
        advancedCreditsUsed: 0,
      }),
    ).toBe("smart-nano");

    expect(
      chooseModel({
        plan: "power",
        classification: "medium",
        advanced: false,
        advancedCreditsUsed: 0,
      }),
    ).toBe("smart-nano");
  });

  it("power + advanced + hard yields smart-mini", () => {
    expect(
      chooseModel({
        plan: "power",
        classification: "hard",
        advanced: true,
        advancedCreditsUsed: 0,
      }),
    ).toBe("smart-mini");
  });
});
