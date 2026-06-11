// One-off: mark a user as actively in a 7-day trial for the plus plan.
// Usage (from functions/): node scripts/set-trial.cjs <email-or-uid>
const fs = require("fs");
const path = require("path");
const { Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getDb } = require("./admin-app.cjs");

const MONTHLY_CREDITS_PLUS = 5103; // mirror of PLANS.plus.monthlyCredits — keep in sync
const MONTHLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TRIAL_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
function computeDailyCap(monthlyCredits, date) {
  return Math.round((monthlyCredits / daysInMonth(date)) * 3);
}

const arg = process.argv[2];
if (!arg) throw new Error("usage: node scripts/set-trial.cjs <email-or-uid>");

(async () => {
  const db = getDb();

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

  const dir = path.join(__dirname, "..", "..", "profile-snapshots");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(dir, `profile-${uid}-BEFORE-SET-TRIAL-${stamp}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(before.data(), null, 2));
  console.log("Snapshot saved to:", snapshotPath);

  const now = new Date();
  const trialExpiresAt = Timestamp.fromMillis(now.getTime() + TRIAL_DAYS_MS);

  const next = {
    plan: "plus",
    planSource: "revenuecat",
    rcAppUserId: uid,
    rcActiveProductId: "memeaiplus",
    rcEntitlementExpiresAt: trialExpiresAt,
    rcIsInTrial: true,
    rcTrialExpiresAt: trialExpiresAt,
    monthlyCredits: MONTHLY_CREDITS_PLUS,
    softDailyCredits: computeDailyCap(MONTHLY_CREDITS_PLUS, now),
    creditsRemaining: MONTHLY_CREDITS_PLUS,
    creditsResetAt: Timestamp.fromMillis(now.getTime() + MONTHLY_WINDOW_MS),
    dailyCreditsUsed: 0,
    dailyResetAt: Timestamp.fromMillis(now.getTime()),
  };

  await ref.set(next, { merge: true });

  const after = (await ref.get()).data();
  console.log("\nDone.");
  console.log("  uid:             ", uid);
  console.log("  plan:            ", after.plan, "(was", before.data().plan + ")");
  console.log("  rcIsInTrial:     ", after.rcIsInTrial);
  console.log("  trialExpiresAt:  ", trialExpiresAt.toDate().toISOString());
  console.log("  monthly:         ", after.monthlyCredits);
  console.log("  remaining:       ", after.creditsRemaining);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
