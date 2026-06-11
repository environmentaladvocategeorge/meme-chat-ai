// Bulk mid-cycle raise of the free tier's credit budget on existing profiles.
//
// PLANS.free.monthlyCredits in functions/src/billing/plans.ts is the
// enforcement source of truth (the quota gate computes the daily cap live from
// it — deploy functions for the new limits to actually take effect). This
// script patches the denormalized per-user copies on profiles/{uid} so
// existing free users get the bump immediately instead of waiting for their
// next monthly reset:
//
//   monthlyCredits   → NEW_FREE_MONTHLY
//   creditsRemaining → += (NEW − old monthly), clamped to [0, NEW]
//                      (spend-preserving: same as NEW − credits already spent
//                      this cycle)
//   softDailyCredits → computeDailyCap(NEW, today), never lowered
//
// Raise-only and idempotent: rerunning is a no-op, paid plans are untouched,
// nothing is ever decreased, and the daily/monthly reset anchors and
// dailyCreditsUsed are left alone. All old docs are snapshotted to
// profile-snapshots/ before writing.
//
// Usage (from functions/):
//   node scripts/raise-free-credits.cjs            # dry run (default)
//   node scripts/raise-free-credits.cjs --apply    # write the changes
const fs = require("fs");
const path = require("path");
const { getDb } = require("./admin-app.cjs");

// Mirror of functions/src/billing/plans.ts. Keep in sync if those change.
const NEW_FREE_MONTHLY = 205;
const DAILY_BURST_FACTOR = 3;

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
function computeDailyCap(monthlyCredits, date) {
  return Math.round((monthlyCredits / daysInMonth(date)) * DAILY_BURST_FACTOR);
}

const apply = process.argv.includes("--apply");

(async () => {
  const db = getDb();
  const now = new Date();
  const newDailyCap = computeDailyCap(NEW_FREE_MONTHLY, now);

  const snap = await db.collection("profiles").where("plan", "==", "free").get();
  console.log(`free profiles: ${snap.size}  |  new monthly: ${NEW_FREE_MONTHLY}  |  daily cap today: ${newDailyCap}`);
  console.log(apply ? "MODE: APPLY\n" : "MODE: dry run (pass --apply to write)\n");

  const changes = [];
  const snapshots = {};

  for (const doc of snap.docs) {
    const d = doc.data();
    // Legacy docs that predate the denormalized monthlyCredits field have an
    // unknown spend baseline — leave creditsRemaining alone for those (their
    // next monthly reset hands them the full new budget) and just set the caps.
    const oldMonthly = typeof d.monthlyCredits === "number" ? d.monthlyCredits : NEW_FREE_MONTHLY;
    const oldRemaining = typeof d.creditsRemaining === "number" ? d.creditsRemaining : NEW_FREE_MONTHLY;
    const oldDaily = typeof d.softDailyCredits === "number" ? d.softDailyCredits : 0;

    const patch = {};
    if (oldMonthly < NEW_FREE_MONTHLY) {
      patch.monthlyCredits = NEW_FREE_MONTHLY;
      // Spend-preserving bump, but never a decrease: a few downgraded-to-free
      // docs still carry a paid tier's leftover balance — leave those alone
      // (their next monthly reset normalizes them to the plan budget anyway).
      const bumped = Math.min(
        NEW_FREE_MONTHLY,
        Math.max(0, oldRemaining + (NEW_FREE_MONTHLY - oldMonthly)),
      );
      if (bumped > oldRemaining) patch.creditsRemaining = bumped;
    } else if (typeof d.monthlyCredits !== "number") {
      patch.monthlyCredits = NEW_FREE_MONTHLY;
    }
    if (oldDaily < newDailyCap) {
      patch.softDailyCredits = newDailyCap;
    }
    if (Object.keys(patch).length === 0) continue;

    snapshots[doc.id] = {
      monthlyCredits: d.monthlyCredits ?? null,
      creditsRemaining: d.creditsRemaining ?? null,
      softDailyCredits: d.softDailyCredits ?? null,
      dailyCreditsUsed: d.dailyCreditsUsed ?? null,
    };
    changes.push({ ref: doc.ref, patch });
    console.log(
      `${doc.id}  monthly ${oldMonthly} -> ${patch.monthlyCredits ?? oldMonthly}` +
        `  remaining ${oldRemaining} -> ${patch.creditsRemaining ?? oldRemaining}` +
        `  daily ${oldDaily} -> ${patch.softDailyCredits ?? oldDaily}` +
        `  (used today: ${d.dailyCreditsUsed ?? 0})`,
    );
  }

  console.log(`\n${changes.length} of ${snap.size} free profiles need a patch.`);
  if (!apply || changes.length === 0) {
    process.exit(0);
  }

  // Snapshot for rollback.
  const dir = path.join(__dirname, "..", "..", "profile-snapshots");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(dir, `free-raise-${NEW_FREE_MONTHLY}-${stamp}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshots, null, 2));
  console.log("Snapshot saved to:", snapshotPath);

  let written = 0;
  while (changes.length) {
    const chunk = changes.splice(0, 400);
    const batch = db.batch();
    for (const { ref, patch } of chunk) batch.update(ref, patch);
    await batch.commit();
    written += chunk.length;
    console.log(`committed ${written} updates...`);
  }
  console.log("Done.");
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
