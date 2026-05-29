import { chooseModel } from "../router";
import { PLANS, PLAN_IDS } from "../plans";

describe("chooseModel", () => {
  it("returns the plan's configured model for every plan", () => {
    for (const plan of PLAN_IDS) {
      expect(chooseModel(plan)).toBe(PLANS[plan].model);
    }
  });

  it("routes free + basic to nano, plus + power to mini", () => {
    expect(chooseModel("free")).toBe("nano");
    expect(chooseModel("basic")).toBe("nano");
    expect(chooseModel("plus")).toBe("mini");
    expect(chooseModel("power")).toBe("mini");
  });
});
