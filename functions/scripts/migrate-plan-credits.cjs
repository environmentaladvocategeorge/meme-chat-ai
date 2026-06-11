// Bulk mid-cycle migration of ALL plan tiers' credit budgets on existing
// profiles. Generalizes raise-free-credits.cjs (free-only) to every plan.
//
// PLANS in functions/src/billing/plans.ts is the enforcement source of truth
// (new grants, cycle resets, and the live daily cap all derive from it — deploy
// functions for the new limits to actually take effect). This script patches
// the denormalized per-user copies on profiles/{uid} so existing users get
// their bump immediately instead of waiting for the next monthly reset:
//
//   monthlyCredits   → NEW[plan]
//   creditsRemaining → += (NEW − old monthly), clamped to [0, NEW]
//                      (spend-preserving: same as NEW − credits already spent
//                      this cycle)
//   softDailyCredits → computeDailyCap(NEW, today), never lowered
//
// Raise-only and idempotent: rerunning is a no-op, nothing is ever decreased,
// and the daily/monthly reset anchors and dailyCreditsUsed are left alone.
// Profiles with an unknown/missing plan are treated as free. All old docs are
// snapshotted to profile-snapshots/ before writing.
//
// Reads the new budgets from the compiled lib so it can never drift from
// plans.ts — run `npm run build` in functions/ first.
//
// Usage (from the repo root or functions/):
//   node functions/scripts/migrate-plan-credits.cjs            # dry run (default)
//   node functions/scripts/migrate-plan-credits.cjs --apply    # write the changes
const fs = require("fs");
const path = require("path");
const { getDb } = require("./admin-app.cjs");
const { PLANS, computeDailyCap } = require("../lib/billing/plans.js");

const apply = process.argv.includes("--apply");

(async () => {
  const db = getDb();
  const now = new Date();

  console.log("target budgets (from compiled lib/billing/plans.js):");
  for (const [plan, cfg] of Object.entries(PLANS)) {
    console.log(
      `  ${plan.padEnd(6)} ${String(cfg.monthlyCredits).padStart(6)} cr/mo  daily cap today: ${computeDailyCap(cfg.monthlyCredits, now)}`,
    );
  }
  console.log(apply ? "MODE: APPLY\n" : "MODE: dry run (pass --apply to write)\n");

  const snap = await db.collection("profiles").get();
  console.log(`profiles: ${snap.size}\n`);

  const changes = [];
  const snapshots = {};
  const byPlan = {};

  for (const doc of snap.docs) {
    const d = doc.data();
    const plan = PLANS[d.plan] ? d.plan : "free";
    byPlan[plan] = (byPlan[plan] ?? 0) + 1;
    const NEW = PLANS[plan].monthlyCredits;
    const newDailyCap = computeDailyCap(NEW, now);

    // Legacy docs that predate the denormalized monthlyCredits field have an
    // unknown spend baseline — leave creditsRemaining alone for those (their
    // next monthly reset hands them the full new budget) and just set the caps.
    const oldMonthly = typeof d.monthlyCredits === "number" ? d.monthlyCredits : NEW;
    const oldRemaining = typeof d.creditsRemaining === "number" ? d.creditsRemaining : NEW;
    const oldDaily = typeof d.softDailyCredits === "number" ? d.softDailyCredits : 0;

    const patch = {};
    if (oldMonthly < NEW) {
      patch.monthlyCredits = NEW;
      // Spend-preserving bump, but never a decrease: some downgraded docs carry
      // a higher tier's leftover balance — leave those alone (their next
      // monthly reset normalizes them to the plan budget anyway).
      const bumped = Math.min(NEW, Math.max(0, oldRemaining + (NEW - oldMonthly)));
      if (bumped > oldRemaining) patch.creditsRemaining = bumped;
    } else if (typeof d.monthlyCredits !== "number") {
      patch.monthlyCredits = NEW;
    }
    if (oldDaily < newDailyCap) {
      patch.softDailyCredits = newDailyCap;
    }
    if (Object.keys(patch).length === 0) continue;

    snapshots[doc.id] = {
      plan: d.plan ?? null,
      monthlyCredits: d.monthlyCredits ?? null,
      creditsRemaining: d.creditsRemaining ?? null,
      softDailyCredits: d.softDailyCredits ?? null,
      dailyCreditsUsed: d.dailyCreditsUsed ?? null,
    };
    changes.push({ ref: doc.ref, patch });
    console.log(
      `${doc.id}  [${plan}]  monthly ${oldMonthly} -> ${patch.monthlyCredits ?? oldMonthly}` +
        `  remaining ${oldRemaining} -> ${patch.creditsRemaining ?? oldRemaining}` +
        `  daily ${oldDaily} -> ${patch.softDailyCredits ?? oldDaily}` +
        `  (used today: ${d.dailyCreditsUsed ?? 0})`,
    );
  }

  console.log(`\nplan mix: ${Object.entries(byPlan).map(([p, c]) => `${p}=${c}`).join("  ")}`);
  console.log(`${changes.length} of ${snap.size} profiles need a patch.`);
  if (!apply || changes.length === 0) {
    process.exit(0);
  }

  // Snapshot for rollback.
  const dir = path.join(__dirname, "..", "..", "profile-snapshots");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(dir, `plan-credits-migration-${stamp}.json`);
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
