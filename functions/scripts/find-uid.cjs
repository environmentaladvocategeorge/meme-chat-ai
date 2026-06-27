// Resolve a Firebase Auth UID from an email. Tries the Auth admin API first
// (works if the CLI user is a project Owner); falls back to a profiles query.
//   node scripts/find-uid.cjs <email>
const { initAdminApp, getDb } = require("./admin-app.cjs");
const { getAuth } = require("firebase-admin/auth");

const email = process.argv[2];
if (!email) throw new Error("usage: node scripts/find-uid.cjs <email>");

(async () => {
  initAdminApp();
  try {
    const u = await getAuth().getUserByEmail(email);
    const providers = (u.providerData || []).map((p) => p.providerId).join(", ");
    console.log("uid:      ", u.uid);
    console.log("email:    ", u.email);
    console.log("providers:", providers);
    process.exit(0);
  } catch (e) {
    console.warn("auth lookup failed:", e.message, "\n— trying profiles query —");
    const db = getDb();
    const snap = await db.collection("profiles").where("email", "==", email).limit(1).get();
    if (snap.empty) throw new Error("no profile with that email either");
    console.log("uid (from profiles):", snap.docs[0].id);
    process.exit(0);
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
