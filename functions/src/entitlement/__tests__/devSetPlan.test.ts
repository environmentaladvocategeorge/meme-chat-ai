import { HttpsError } from "firebase-functions/v2/https";
import { devSetPlanImpl } from "../devSetPlan";

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
