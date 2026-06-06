// Backfill script: patches all free-plan profiles down to the new 187-credit
// monthly budget (a 15% trim from the prior 220, applied on day 5 of launch).
// Only writes to users who currently have monthlyCredits > 187 so it is safe to
// re-run. Does NOT touch paid users or users already at/below the new cap.
//
// Fields updated per user:
//   monthlyCredits   → 187
//   softDailyCredits → computeDailyCap(187, now)   (re-derived from today's month length)
//   creditsRemaining → SPEND-PRESERVING: 187 − (credits already spent this cycle)
//                      where spent = oldMonthlyCredits − oldCreditsRemaining.
//                      This charges the trim against unspent budget rather than
//                      refunding what a user has already used. Floored at 0.
//
// NOTE: keep NEW_MONTHLY_CREDITS in sync with PLANS.free.monthlyCredits
// (functions/src/billing/plans.ts) — this standalone script can't import the TS.
//
// Usage (from functions/):
//   node scripts/patch-free-credits.cjs            # dry run — prints what would change
//   node scripts/patch-free-credits.cjs --apply    # writes to Firestore
const fs = require("fs");
const path = require("path");
const { getDb } = require("./admin-app.cjs");

const NEW_MONTHLY_CREDITS = 187;
const DAILY_BURST_FACTOR = 3;
const BATCH_SIZE = 400; // well under the 500-op Firestore batch limit
const DRY_RUN = !process.argv.includes("--apply");

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
function computeDailyCap(monthlyCredits, date) {
  return Math.round((monthlyCredits / daysInMonth(date)) * DAILY_BURST_FACTOR);
}

// Spend-preserving new remaining: figure out what the user has already spent
// this cycle from their OLD budget, then deduct that from the NEW budget. Never
// negative, never above the new cap.
function computeNewRemaining(current) {
  const oldMonthly =
    typeof current.monthlyCredits === "number" ? current.monthlyCredits : NEW_MONTHLY_CREDITS;
  const oldRemaining =
    typeof current.creditsRemaining === "number" ? current.creditsRemaining : oldMonthly;
  const spent = Math.max(0, oldMonthly - oldRemaining);
  return Math.max(0, Math.min(NEW_MONTHLY_CREDITS, NEW_MONTHLY_CREDITS - spent));
}

(async () => {
  const db = getDb();
  const now = new Date();
  const newDailyCap = computeDailyCap(NEW_MONTHLY_CREDITS, now);

  console.log(`\npatch-free-credits — ${DRY_RUN ? "DRY RUN (pass --apply to write)" : "LIVE WRITE"}`);
  console.log(`  new monthlyCredits : ${NEW_MONTHLY_CREDITS}`);
  console.log(`  new softDailyCredits: ${newDailyCap} (${daysInMonth(now)}-day month)`);
  console.log(`  remaining policy   : spend-preserving (187 − credits already spent)\n`);

  // Page through all free profiles.
  let query = db.collection("profiles").where("plan", "==", "free");
  const snapshot = await query.get();

  const toUpdate = [];
  let alreadyAtCap = 0;

  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (typeof d.monthlyCredits !== "number" || d.monthlyCredits <= NEW_MONTHLY_CREDITS) {
      alreadyAtCap++;
      continue;
    }
    toUpdate.push({ ref: doc.ref, current: d });
  }

  console.log(`Free profiles scanned : ${snapshot.size}`);
  console.log(`Already at/below cap  : ${alreadyAtCap}`);
  console.log(`Will patch            : ${toUpdate.length}\n`);

  if (toUpdate.length === 0) {
    console.log("Nothing to do.");
    process.exit(0);
  }

  // Save a rollback snapshot before writing anything.
  const snapshotDir = path.join(__dirname, "..", "..", "profile-snapshots");
  fs.mkdirSync(snapshotDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const snapshotFile = path.join(snapshotDir, `patch-free-credits-${stamp}.json`);
  const rollback = toUpdate.map(({ ref, current }) => ({ uid: ref.id, before: current }));
  fs.writeFileSync(snapshotFile, JSON.stringify(rollback, null, 2));
  console.log(`Rollback snapshot     : ${snapshotFile}\n`);

  if (DRY_RUN) {
    console.log("Sample of users that would be patched (first 10):");
    for (const { ref, current } of toUpdate.slice(0, 10)) {
      const newRemaining = computeNewRemaining(current);
      const spent = Math.max(0, current.monthlyCredits - (current.creditsRemaining ?? current.monthlyCredits));
      console.log(
        `  ${ref.id}  monthly ${current.monthlyCredits} → ${NEW_MONTHLY_CREDITS}` +
        `  spent ${spent}  remaining ${current.creditsRemaining} → ${newRemaining}` +
        `  daily ${current.softDailyCredits} → ${newDailyCap}`
      );
    }
    if (toUpdate.length > 10) console.log(`  … and ${toUpdate.length - 10} more`);
    console.log("\nRe-run with --apply to commit.");
    process.exit(0);
  }

  // Commit in batches.
  let written = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { ref, current } of chunk) {
      batch.update(ref, {
        monthlyCredits: NEW_MONTHLY_CREDITS,
        softDailyCredits: newDailyCap,
        creditsRemaining: computeNewRemaining(current),
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  committed ${written} / ${toUpdate.length}`);
  }

  console.log(`\nDone. ${written} profiles patched.`);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
