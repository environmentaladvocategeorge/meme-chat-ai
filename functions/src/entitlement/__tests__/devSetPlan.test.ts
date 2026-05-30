import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { PLANS, computeDailyCap } from "../../billing/plans";
import { devSetPlanImpl } from "../devSetPlan";

// Keep Timestamp et al. real (planActivationFields needs Timestamp.fromMillis);
// only stub getFirestore so we can capture the written payload.
jest.mock("firebase-admin/firestore", () => ({
  ...jest.requireActual("firebase-admin/firestore"),
  getFirestore: jest.fn(),
}));

// devSetPlanImpl performs a Firestore write at the end; for the dev-gating
// tests we only need to confirm it throws BEFORE reaching the write, so a
// Firestore stub isn't required when ALLOW_DEV_SETPLAN/NODE_ENV are gating.

describe("devSetPlanImpl gating", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DEV_SETPLAN;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) delete process.env.ALLOW_DEV_SETPLAN;
    else process.env.ALLOW_DEV_SETPLAN = originalAllow;
  });

  it("throws failed-precondition in production even if ALLOW_DEV_SETPLAN=true", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_DEV_SETPLAN = "true";
    await expect(devSetPlanImpl("uid", "plus")).rejects.toBeInstanceOf(HttpsError);
    await expect(devSetPlanImpl("uid", "plus")).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("throws failed-precondition when ALLOW_DEV_SETPLAN is unset", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.ALLOW_DEV_SETPLAN;
    await expect(devSetPlanImpl("uid", "plus")).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("throws unauthenticated when no uid is supplied", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_DEV_SETPLAN = "true";
    await expect(devSetPlanImpl(undefined, "plus")).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("throws invalid-argument for unknown plan", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_DEV_SETPLAN = "true";
    await expect(devSetPlanImpl("uid", "ultra")).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("throws invalid-argument for non-string plan", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_DEV_SETPLAN = "true";
    await expect(devSetPlanImpl("uid", 42)).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });
});

describe("devSetPlanImpl write", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_DEV_SETPLAN;

  beforeEach(() => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_DEV_SETPLAN = "true";
  });
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) delete process.env.ALLOW_DEV_SETPLAN;
    else process.env.ALLOW_DEV_SETPLAN = originalAllow;
    jest.clearAllMocks();
  });

  function captureWrite() {
    const set = jest.fn().mockResolvedValue(undefined);
    const doc = jest.fn().mockReturnValue({ set });
    (getFirestore as jest.Mock).mockReturnValue({ doc });
    return { set, doc };
  }

  it("persists the upgraded plan's increased monthly + daily limits", async () => {
    const { set, doc } = captureWrite();

    const res = await devSetPlanImpl("uid-1", "power");

    expect(res).toEqual({
      plan: "power",
      creditsRemaining: PLANS.power.monthlyCredits,
    });
    expect(doc).toHaveBeenCalledWith("profiles/uid-1");
    expect(set).toHaveBeenCalledTimes(1);

    const [update, opts] = set.mock.calls[0];
    expect(opts).toEqual({ merge: true });
    expect(update.plan).toBe("power");
    expect(update.monthlyCredits).toBe(PLANS.power.monthlyCredits);
    expect(update.creditsRemaining).toBe(PLANS.power.monthlyCredits);
    expect(update.dailyCreditsUsed).toBe(0);
    // The daily soft cap written for power is the computed cap AND strictly
    // larger than free's — i.e. the limit genuinely went up on upgrade.
    expect(update.softDailyCredits).toBe(
      computeDailyCap(PLANS.power.monthlyCredits, new Date()),
    );
    expect(update.softDailyCredits).toBeGreaterThan(
      computeDailyCap(PLANS.free.monthlyCredits, new Date()),
    );
  });

  it("writes a strictly higher daily cap for each higher tier", async () => {
    const caps: Record<string, number> = {};
    for (const plan of ["free", "basic", "plus", "power"] as const) {
      const { set } = captureWrite();
      await devSetPlanImpl("uid-1", plan);
      caps[plan] = set.mock.calls[0][0].softDailyCredits;
      jest.clearAllMocks();
    }
    expect(caps.basic).toBeGreaterThan(caps.free);
    expect(caps.plus).toBeGreaterThan(caps.basic);
    expect(caps.power).toBeGreaterThan(caps.plus);
  });
});
