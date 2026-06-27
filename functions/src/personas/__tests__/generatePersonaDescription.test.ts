import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { PLANS } from "../../billing/plans";
import type { ProfileBilling } from "../../entitlement/schema";
import {
  generateDescriptionForUser,
  PERSONA_DESCRIPTION_MAX,
  type GenerateDescriptionDeps,
} from "../generatePersonaDescription";

function billing(over: Partial<ProfileBilling> = {}): ProfileBilling {
  const monthly = PLANS.free.monthlyCredits;
  return {
    plan: "free",
    planSource: "stub",
    rcAppUserId: null,
    rcActiveProductId: null,
    rcEntitlementExpiresAt: null,
    rcIsInTrial: false,
    rcTrialExpiresAt: null,
    monthlyCredits: monthly,
    softDailyCredits: 100,
    creditsRemaining: monthly,
    creditsResetAt: Timestamp.fromMillis(Date.now() + 1_000_000),
    dailyCreditsUsed: 0,
    dailyResetAt: Timestamp.fromMillis(Date.now() + 1_000_000),
    ...over,
  };
}

const USAGE = {
  inputTokens: 50,
  cachedInputTokens: 0,
  outputTokens: 40,
  reasoningTokens: 10,
};

function deps(over: Partial<GenerateDescriptionDeps> = {}): {
  deps: GenerateDescriptionDeps;
  charged: number;
} {
  const state = { charged: 0 };
  return {
    get charged() {
      return state.charged;
    },
    deps: {
      generate: jest.fn().mockResolvedValue({ text: "a chaotic gym goblin", usage: USAGE }),
      moderate: jest.fn().mockResolvedValue(false),
      charge: jest.fn(async () => {
        state.charged += 1;
      }),
      ...over,
    },
  };
}

const input = { displayName: "Gym Goblin", toneTags: ["hype"] };

describe("generateDescriptionForUser", () => {
  it("returns the generated description and charges once", async () => {
    const d = deps();
    const result = await generateDescriptionForUser("free", billing(), input, d.deps);
    expect(result.description).toBe("a chaotic gym goblin");
    expect(d.charged).toBe(1);
  });

  it("refuses when the daily window is exhausted, without generating or charging", async () => {
    const d = deps();
    await expect(
      generateDescriptionForUser("free", billing({ dailyCreditsUsed: 10_000 }), input, d.deps),
    ).rejects.toThrow(HttpsError);
    expect(d.deps.generate).not.toHaveBeenCalled();
    expect(d.charged).toBe(0);
  });

  it("rejects a flagged suggestion and never charges", async () => {
    const d = deps({ moderate: jest.fn().mockResolvedValue(true) });
    await expect(
      generateDescriptionForUser("free", billing(), input, d.deps),
    ).rejects.toThrow(HttpsError);
    expect(d.charged).toBe(0);
  });

  it("rejects an empty generation", async () => {
    const d = deps({ generate: jest.fn().mockResolvedValue({ text: "   ", usage: USAGE }) });
    await expect(
      generateDescriptionForUser("free", billing(), input, d.deps),
    ).rejects.toThrow(HttpsError);
    expect(d.charged).toBe(0);
  });

  it("rejects an unknown input shape", async () => {
    const d = deps();
    await expect(
      generateDescriptionForUser("free", billing(), { junk: true }, d.deps),
    ).rejects.toThrow(HttpsError);
  });

  it("hard-clamps an overshoot to the field cap", async () => {
    const long = "word ".repeat(400); // ~2000 chars
    const d = deps({ generate: jest.fn().mockResolvedValue({ text: long, usage: USAGE }) });
    const result = await generateDescriptionForUser("free", billing(), input, d.deps);
    expect(result.description.length).toBeLessThanOrEqual(PERSONA_DESCRIPTION_MAX);
  });
});
