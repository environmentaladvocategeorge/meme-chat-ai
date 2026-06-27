// One-off manual reset of a user's DAILY soft cap. Looks the user up by email,
// then zeroes profiles/{uid}.dailyCreditsUsed so today's allowance is fully
// freed (the monthly window is untouched). The next loadEntitlement keeps the
// zero since dailyResetAt is unchanged. For test/support use only.
//
// Usage (from functions/):  node scripts/reset-daily.cjs <email>
const { getAuth } = require("firebase-admin/auth");
const { getDb, initAdminApp } = require("./admin-app.cjs");

const email = process.argv[2];
if (!email) {
  throw new Error("usage: node scripts/reset-daily.cjs <email>");
}

(async () => {
  initAdminApp();
  const db = getDb();

  const user = await getAuth().getUserByEmail(email);
  const uid = user.uid;

  const ref = db.doc(`profiles/${uid}`);
  const before = await ref.get();
  if (!before.exists) throw new Error(`profiles/${uid} does not exist`);

  const prevUsed = before.data().dailyCreditsUsed;
  await ref.set({ dailyCreditsUsed: 0 }, { merge: true });

  const after = (await ref.get()).data();
  console.log("email:           ", email);
  console.log("uid:             ", uid);
  console.log("dailyCreditsUsed:", prevUsed, "->", after.dailyCreditsUsed);
  console.log("softDailyCredits:", after.softDailyCredits);
  console.log("creditsRemaining:", after.creditsRemaining, "(monthly untouched)");
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
