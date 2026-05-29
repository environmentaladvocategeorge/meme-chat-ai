import { chooseModel } from "../router";
import { PLANS, PLAN_IDS } from "../plans";

describe("chooseModel", () => {
  it("returns the plan's configured model for every plan", () => {
    for (const plan of PLAN_IDS) {
      expect(chooseModel(plan)).toBe(PLANS[plan].model);
    }
  });

  it("routes every user-facing tier to mini (uniform model)", () => {
    expect(chooseModel("free")).toBe("mini");
    expect(chooseModel("basic")).toBe("mini");
    expect(chooseModel("plus")).toBe("mini");
    expect(chooseModel("power")).toBe("mini");
  });
});
