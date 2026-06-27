// Read-only: dump a user_persona doc in full (publicConfig + stored input +
// rendered fragments) so we can see exactly what's persisted for it.
// Usage: node functions/scripts/dump-persona.cjs [nameSubstring]
const { initAdminApp, getDb } = require("./admin-app.cjs");

const nameArg = (process.argv[2] || "gym").toLowerCase();

(async () => {
  initAdminApp();
  const db = getDb();
  const snap = await db.collection("user_personas").limit(100).get();

  const match = snap.docs.find((d) => {
    const pc = d.data().publicConfig || {};
    return (pc.displayName || "").toLowerCase().includes(nameArg);
  });

  if (!match) {
    console.log(`No user_persona whose displayName contains "${nameArg}".`);
    console.log("Available:", snap.docs.map((d) => (d.data().publicConfig || {}).displayName));
    process.exit(0);
  }

  const d = match.data();
  console.log("docId:", match.id);
  console.log("ownerUid:", d.ownerUid);
  console.log("\n===== TOP-LEVEL KEYS =====");
  console.log(Object.keys(d));
  console.log("\n===== publicConfig =====");
  console.log(JSON.stringify(d.publicConfig, null, 2));
  console.log("\n===== input (builder payload, for edit round-trip) =====");
  console.log(JSON.stringify(d.input ?? d.spec ?? null, null, 2));
  console.log("\n===== fragments (rendered persona prompt as stored) =====");
  console.log(JSON.stringify(d.fragments, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
