import {
  isKnownRcProduct,
  PLAN_RANK,
  resolvePlanFromRcProductIds,
} from "../billing";

describe("PLAN_RANK", () => {
  it("orders free < basic < plus < power", () => {
    expect(PLAN_RANK.free).toBeLessThan(PLAN_RANK.basic);
    expect(PLAN_RANK.basic).toBeLessThan(PLAN_RANK.plus);
    expect(PLAN_RANK.plus).toBeLessThan(PLAN_RANK.power);
  });
});

describe("isKnownRcProduct", () => {
  it("recognizes both test-store and production product ids", () => {
    expect(isKnownRcProduct("monthly")).toBe(true);
    expect(isKnownRcProduct("monthly_2")).toBe(true);
    expect(isKnownRcProduct("memeaibasic")).toBe(true);
    expect(isKnownRcProduct("memeaipower")).toBe(true);
  });

  it("rejects unknown ids", () => {
    expect(isKnownRcProduct("bogus")).toBe(false);
    expect(isKnownRcProduct("")).toBe(false);
  });
});

describe("resolvePlanFromRcProductIds", () => {
  it("defaults to free with no known products", () => {
    expect(resolvePlanFromRcProductIds([])).toBe("free");
    expect(resolvePlanFromRcProductIds(["bogus", "also-bogus"])).toBe("free");
  });

  it("maps a single known product to its plan", () => {
    expect(resolvePlanFromRcProductIds(["memeaibasic"])).toBe("basic");
    expect(resolvePlanFromRcProductIds(["monthly_2"])).toBe("plus");
    expect(resolvePlanFromRcProductIds(["memeaipower"])).toBe("power");
  });

  it("picks the HIGHEST-ranked plan when several entitlements are active", () => {
    expect(
      resolvePlanFromRcProductIds(["memeaibasic", "memeaipower", "memeaiplus"]),
    ).toBe("power");
  });

  it("ignores unknown ids mixed in with a known one", () => {
    expect(resolvePlanFromRcProductIds(["bogus", "monthly"])).toBe("basic");
  });
});
