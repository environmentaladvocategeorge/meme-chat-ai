import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { PLANS } from "../../billing/plans";
import type { ProfileBilling } from "../../entitlement/schema";
import {
  buildAvatarPrompt,
  generateAvatarForUser,
  type GenerateAvatarDeps,
} from "../generatePersonaAvatar";

// A billing fixture with plenty of headroom on both windows. Overrides let a
// test exhaust a window to exercise the quota gate.
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

function deps(over: Partial<GenerateAvatarDeps> = {}): {
  deps: GenerateAvatarDeps;
  charged: Array<{ credits: number; costUsd: number }>;
} {
  const charged: Array<{ credits: number; costUsd: number }> = [];
  return {
    charged,
    deps: {
      moderatePrompt: jest.fn().mockResolvedValue(false),
      generate: jest.fn().mockResolvedValue({ b64: "BASE64", costUsd: 0.005 }),
      charge: jest.fn(async (credits: number, costUsd: number) => {
        charged.push({ credits, costUsd });
      }),
      ...over,
    },
  };
}

describe("generateAvatarForUser", () => {
  it("rejects an empty or oversized description", async () => {
    const { deps: d } = deps();
    await expect(generateAvatarForUser("free", billing(), { description: "" }, d)).rejects.toThrow(
      HttpsError,
    );
    await expect(
      generateAvatarForUser("free", billing(), { description: "x".repeat(101) }, d),
    ).rejects.toThrow(HttpsError);
  });

  it("returns the image and charges credits on success", async () => {
    const { deps: d, charged } = deps();
    const result = await generateAvatarForUser(
      "free",
      billing(),
      { description: "a grumpy cat in a hoodie" },
      d,
    );
    expect(result.imageBase64).toBe("BASE64");
    // $0.005 → 5 credits (above the 0.1 floor).
    expect(charged).toEqual([{ credits: 5, costUsd: 0.005 }]);
  });

  it("blocks generation when the daily window is exhausted (no charge)", async () => {
    const { deps: d, charged } = deps();
    await expect(
      generateAvatarForUser(
        "free",
        billing({ dailyCreditsUsed: 1_000_000, softDailyCredits: 10 }),
        { description: "a cool frog" },
        d,
      ),
    ).rejects.toMatchObject({ message: "quota_daily" });
    expect(d.generate).not.toHaveBeenCalled();
    expect(charged).toEqual([]);
  });

  it("blocks generation when the monthly balance is exhausted (no charge)", async () => {
    const { deps: d, charged } = deps();
    await expect(
      generateAvatarForUser(
        "free",
        billing({ creditsRemaining: 0 }),
        { description: "a cool frog" },
        d,
      ),
    ).rejects.toMatchObject({ message: "quota_monthly" });
    expect(charged).toEqual([]);
  });

  it("rejects a flagged prompt before spending an image call", async () => {
    const { deps: d, charged } = deps({ moderatePrompt: jest.fn().mockResolvedValue(true) });
    await expect(
      generateAvatarForUser("free", billing(), { description: "something bad" }, d),
    ).rejects.toMatchObject({ message: "prompt_rejected" });
    expect(d.generate).not.toHaveBeenCalled();
    expect(charged).toEqual([]);
  });
});

describe("buildAvatarPrompt", () => {
  it("wraps the description in avatar framing and includes it as the subject", () => {
    const prompt = buildAvatarPrompt("  a wizard frog  ");
    expect(prompt).toContain("profile-picture avatar");
    expect(prompt).toContain("a wizard frog");
    expect(prompt).not.toContain("  a wizard frog  ");
  });

  it("gives consecutive variants different compositions (so the pair diverges)", () => {
    const a = buildAvatarPrompt("a grumpy cat", 0);
    const b = buildAvatarPrompt("a grumpy cat", 1);
    expect(a).not.toBe(b);
    // Out-of-range variants wrap safely instead of producing undefined.
    expect(buildAvatarPrompt("a grumpy cat", 999)).toContain("Composition (default");
    expect(buildAvatarPrompt("a grumpy cat", 999)).not.toContain("undefined");
    expect(buildAvatarPrompt("a grumpy cat", -1)).toContain("Composition (default");
    expect(buildAvatarPrompt("a grumpy cat", -1)).not.toContain("undefined");
  });
});
