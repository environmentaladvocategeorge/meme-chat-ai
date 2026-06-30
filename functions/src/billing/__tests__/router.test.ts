import { chooseModel, chooseReplyModel } from "../router";
import { PLANS, PLAN_IDS } from "../plans";

describe("chooseModel", () => {
  it("returns the plan's configured model for every plan", () => {
    for (const plan of PLAN_IDS) {
      expect(chooseModel(plan)).toBe(PLANS[plan].model);
    }
  });

  it("routes every user-facing tier to gpt-5.4-mini (uniform model)", () => {
    expect(chooseModel("free")).toBe("gpt-5.4-mini");
    expect(chooseModel("basic")).toBe("gpt-5.4-mini");
    expect(chooseModel("plus")).toBe("gpt-5.4-mini");
    expect(chooseModel("power")).toBe("gpt-5.4-mini");
  });
});

describe("chooseReplyModel (Big Brain)", () => {
  it("defaults to the plan's standard model when Big Brain is off/absent", () => {
    for (const plan of PLAN_IDS) {
      expect(chooseReplyModel(plan)).toBe(chooseModel(plan));
      expect(chooseReplyModel(plan, { bigBrain: false })).toBe(chooseModel(plan));
    }
  });

  it("upgrades the reply to full gpt-5.4 on EVERY tier when Big Brain is on", () => {
    for (const plan of PLAN_IDS) {
      expect(chooseReplyModel(plan, { bigBrain: true })).toBe("gpt-5.4");
    }
  });
});
