// One-off manual entitlement grant. Writes the billing fields on
// profiles/{uid} directly, for cases where a user's entitlement is stranded on
// a different RevenueCat customer (e.g. a redeem code redeemed on the web
// BEFORE the app was installed, so it never aliased onto the device identity).
//
// Why a direct Firestore write instead of fixing it in the RevenueCat
// dashboard: this app resolves the PLAN TIER from the store product id
// (memeaibasic/plus/power). A RevenueCat promotional-entitlement grant does not
// carry one of those product ids and does not fire an INITIAL_PURCHASE webhook,
// so granting in RC would leave the profile on `free`. The profile doc is the
// authoritative source the app enforces against, so we set it here.
//
// IMPORTANT: planSource MUST be "revenuecat". The client fires an optimistic
// syncRevenueCatPlan on every CustomerInfo update; for this customer RC reports
// no active product, so it proposes `free`. That callable only skips the
// downgrade when current.planSource === "revenuecat" (see syncPlan.ts). With
// any other source the next app open would knock the user back to free.
//
// Usage (from functions/):  node scripts/grant-plan.cjs <uid> [plan] [trialDays]
//   defaults: plan=plus, trialDays=365
const fs = require("fs");
const path = require("path");
const { Timestamp } = require("firebase-admin/firestore");
const { getDb } = require("./admin-app.cjs");

// Mirror of functions/src/billing/plans.ts. Keep in sync if those change.
const MONTHLY_CREDITS = { free: 370, basic: 1953, plus: 5103, power: 11052 };
const PRODUCT_BY_PLAN = {
  basic: "memeaibasic",
  plus: "memeaiplus",
  power: "memeaipower",
};
const DAILY_BURST_FACTOR = 3;
const MONTHLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
function computeDailyCap(monthlyCredits, date) {
  return Math.round((monthlyCredits / daysInMonth(date)) * DAILY_BURST_FACTOR);
}

const uid = process.argv[2];
const plan = process.argv[3] || "plus";
const trialDays = Number(process.argv[4] || 365);

if (!uid) {
  throw new Error("usage: node scripts/grant-plan.cjs <uid> [plan=plus] [trialDays=365]");
}
if (!(plan in MONTHLY_CREDITS) || plan === "free") {
  throw new Error(`plan must be one of basic|plus|power, got: ${plan}`);
}

(async () => {
  const db = getDb();
  const ref = db.doc(`profiles/${uid}`);
  const before = await ref.get();
  if (!before.exists) throw new Error(`profiles/${uid} does not exist`);

  // Snapshot for rollback.
  const dir = path.join(__dirname, "..", "..", "profile-snapshots");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(
    path.join(dir, `profile-${uid}-OLD-${stamp}.json`),
    JSON.stringify(before.data(), null, 2),
  );

  const now = new Date();
  const monthlyCredits = MONTHLY_CREDITS[plan];

  const next = {
    plan,
    planSource: "revenuecat",
    rcAppUserId: uid,
    rcActiveProductId: PRODUCT_BY_PLAN[plan],
    // Informational record of when the manual grant "should" end. NOTE: nothing
    // auto-enforces this — see the warning printed at the end.
    rcEntitlementExpiresAt: Timestamp.fromMillis(
      now.getTime() + trialDays * 24 * 60 * 60 * 1000,
    ),
    // Standard monthly rolling window so credits refill each month at the plan
    // rate (computeResets refills to PLANS[plan].monthlyCredits on each hop).
    monthlyCredits,
    softDailyCredits: computeDailyCap(monthlyCredits, now),
    creditsRemaining: monthlyCredits,
    creditsResetAt: Timestamp.fromMillis(now.getTime() + MONTHLY_WINDOW_MS),
    dailyCreditsUsed: 0,
    // Due now: the next loadEntitlement does a daily reset and re-anchors
    // dailyResetAt to the proper Eastern midnight + recomputes the daily cap.
    dailyResetAt: Timestamp.fromMillis(now.getTime()),
  };

  await ref.set(next, { merge: true });

  const after = (await ref.get()).data();
  console.log("uid:        ", uid);
  console.log("plan:       ", after.plan, "(was", before.data().plan + ")");
  console.log("planSource: ", after.planSource);
  console.log("product:    ", after.rcActiveProductId);
  console.log(
    "monthly:    ",
    after.monthlyCredits,
    "remaining",
    after.creditsRemaining,
  );
  console.log("softDaily:  ", after.softDailyCredits);
  console.log(
    "expiresAt:  ",
    after.rcEntitlementExpiresAt.toDate().toISOString(),
  );
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
