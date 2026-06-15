// Read-only diagnostic: dumps user_personas docs + each owner account's
// emailVerified flag, and flags whether each doc would survive the client's
// mapPersonaDoc (the picker silently drops anything that wouldn't). Helps answer
// "why don't my saved bots show up". No writes.
//
// Usage:  node functions/scripts/inspect-personas.cjs [email]
const { initAdminApp, getDb } = require("./admin-app.cjs");
const { getAuth } = require("firebase-admin/auth");

const emailArg = process.argv[2];

function ts(v) {
  return v && typeof v.toDate === "function" ? v.toDate().toISOString() : v;
}

(async () => {
  initAdminApp();
  const db = getDb();
  const auth = getAuth();

  if (emailArg) {
    try {
      const u = await auth.getUserByEmail(emailArg);
      console.log(`\n== account for ${emailArg} ==`);
      console.log("  uid:          ", u.uid);
      console.log("  emailVerified:", u.emailVerified, u.emailVerified ? "" : "  <-- read rule requires this!");
      console.log("  disabled:     ", u.disabled);
      console.log("  providers:    ", u.providerData.map((p) => p.providerId).join(", "));
      console.log("  creationTime: ", u.metadata.creationTime);
      console.log("  lastSignIn:   ", u.metadata.lastSignInTime);
      console.log("  lastRefresh:  ", u.metadata.lastRefreshTime);
      console.log("  tokensValidAfter:", u.tokensValidAfterTime);
    } catch (e) {
      console.log(`\ncould not resolve ${emailArg}: ${e.message}`);
    }
  }

  const snap = await db.collection("user_personas").limit(100).get();
  console.log(`\n== user_personas: ${snap.size} doc(s) ==`);

  const owners = new Set();
  for (const doc of snap.docs) {
    const d = doc.data();
    const pc = d.publicConfig || {};
    const mappable =
      typeof pc.displayName === "string" &&
      pc.displayName.length > 0 &&
      typeof pc.shortDescription === "string" &&
      pc.shortDescription.length > 0 &&
      Array.isArray(pc.toneTags);
    owners.add(d.ownerUid);
    console.log("-".repeat(56));
    console.log("  docId:        ", doc.id);
    console.log("  ownerUid:     ", d.ownerUid);
    console.log("  isEnabled:    ", d.isEnabled);
    console.log("  displayName:  ", pc.displayName);
    console.log("  shortDesc:    ", pc.shortDescription);
    console.log("  toneTags:     ", JSON.stringify(pc.toneTags));
    console.log("  avatarUrl:    ", pc.avatarUrl ? "(set)" : "(none)");
    console.log("  hasFragments: ", !!d.fragments);
    console.log("  createdAt:    ", ts(d.createdAt));
    console.log("  >> shows in picker (client-mappable):", mappable);
  }

  console.log(`\n== owner accounts (${owners.size}) ==`);
  for (const uid of owners) {
    try {
      const u = await auth.getUser(uid);
      console.log(
        `  ${uid}  email=${u.email}  emailVerified=${u.emailVerified}` +
          (u.emailVerified ? "" : "  <-- unverified: list query DENIED by rules"),
      );
    } catch (e) {
      console.log(`  ${uid}  (auth lookup failed: ${e.message})`);
    }
  }

  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
