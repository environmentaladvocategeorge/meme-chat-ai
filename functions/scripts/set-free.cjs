// One-off: reset a user to the free plan by email or UID.
// Usage (from functions/): node scripts/set-free.cjs <email-or-uid>
const fs = require("fs");
const path = require("path");
const { Timestamp } = require("firebase-admin/firestore");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDb, PROJECT_ID } = require("./admin-app.cjs");

const MONTHLY_CREDITS_FREE = 220;
const MONTHLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
function computeDailyCap(monthlyCredits, date) {
  return Math.round((monthlyCredits / daysInMonth(date)) * 3);
}

const arg = process.argv[2];
if (!arg) throw new Error("usage: node scripts/set-free.cjs <email-or-uid>");

(async () => {
  const db = getDb(); // initializes firebase-admin

  // Resolve UID — either passed directly or looked up by email.
  let uid;
  if (arg.includes("@")) {
    const user = await getAuth().getUserByEmail(arg);
    uid = user.uid;
    console.log(`Resolved ${arg} → uid: ${uid}`);
  } else {
    uid = arg;
  }

  const ref = db.doc(`profiles/${uid}`);
  const before = await ref.get();
  if (!before.exists) throw new Error(`profiles/${uid} does not exist`);

  // Snapshot for rollback.
  const dir = path.join(__dirname, "..", "..", "profile-snapshots");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(dir, `profile-${uid}-BEFORE-SET-FREE-${stamp}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(before.data(), null, 2));
  console.log("Snapshot saved to:", snapshotPath);

  const now = new Date();
  const next = {
    plan: "free",
    // Keep planSource as "revenuecat" so the client-side syncRevenueCatPlan
    // callable (which proposes free when RC has no active sub) doesn't fight
    // itself trying to downgrade what's already free.
    planSource: "revenuecat",
    rcAppUserId: uid,
    rcActiveProductId: null,
    rcEntitlementExpiresAt: null,
    rcIsInTrial: false,
    rcTrialExpiresAt: null,
    monthlyCredits: MONTHLY_CREDITS_FREE,
    softDailyCredits: computeDailyCap(MONTHLY_CREDITS_FREE, now),
    creditsRemaining: MONTHLY_CREDITS_FREE,
    creditsResetAt: Timestamp.fromMillis(now.getTime() + MONTHLY_WINDOW_MS),
    dailyCreditsUsed: 0,
    dailyResetAt: Timestamp.fromMillis(now.getTime()),
  };

  await ref.set(next, { merge: true });

  const after = (await ref.get()).data();
  console.log("\nDone.");
  console.log("  uid:        ", uid);
  console.log("  plan:       ", after.plan, "(was", before.data().plan + ")");
  console.log("  planSource: ", after.planSource);
  console.log("  monthly:    ", after.monthlyCredits);
  console.log("  remaining:  ", after.creditsRemaining);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
