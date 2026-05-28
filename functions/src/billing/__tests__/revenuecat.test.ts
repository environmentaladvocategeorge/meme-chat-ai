import {
  REVENUECAT_PRODUCT_TO_PLAN,
  isKnownRcProduct,
  resolvePlanFromRcEntitlements,
} from "../revenuecat";

describe("REVENUECAT_PRODUCT_TO_PLAN", () => {
  it("covers monthly / monthly_2 / monthly_3", () => {
    expect(REVENUECAT_PRODUCT_TO_PLAN.monthly).toBe("basic");
    expect(REVENUECAT_PRODUCT_TO_PLAN.monthly_2).toBe("plus");
    expect(REVENUECAT_PRODUCT_TO_PLAN.monthly_3).toBe("power");
  });
});

describe("isKnownRcProduct", () => {
  it("recognizes mapped product ids", () => {
    expect(isKnownRcProduct("monthly")).toBe(true);
    expect(isKnownRcProduct("monthly_2")).toBe(true);
    expect(isKnownRcProduct("monthly_3")).toBe(true);
  });

  it("rejects unknown ids", () => {
    expect(isKnownRcProduct("yearly")).toBe(false);
    expect(isKnownRcProduct("")).toBe(false);
    expect(isKnownRcProduct("MONTHLY")).toBe(false);
  });
});

describe("resolvePlanFromRcEntitlements", () => {
  it("returns free for empty entitlement set", () => {
    expect(resolvePlanFromRcEntitlements([])).toBe("free");
  });

  it("returns basic for [monthly]", () => {
    expect(resolvePlanFromRcEntitlements(["monthly"])).toBe("basic");
  });

  it("returns plus for [monthly_2]", () => {
    expect(resolvePlanFromRcEntitlements(["monthly_2"])).toBe("plus");
  });

  it("returns power for [monthly_3]", () => {
    expect(resolvePlanFromRcEntitlements(["monthly_3"])).toBe("power");
  });

  it("picks highest-rank when monthly and monthly_3 are both active (RC race)", () => {
    expect(resolvePlanFromRcEntitlements(["monthly", "monthly_3"])).toBe("power");
    expect(resolvePlanFromRcEntitlements(["monthly_3", "monthly"])).toBe("power");
  });

  it("ignores unknown product ids", () => {
    expect(resolvePlanFromRcEntitlements(["yearly", "monthly"])).toBe("basic");
    expect(resolvePlanFromRcEntitlements(["yearly"])).toBe("free");
  });
});
