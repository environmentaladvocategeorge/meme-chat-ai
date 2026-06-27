// One-off: delete a user_persona by display-name substring (the local Gym Bro
// test bot), plus its uploaded avatar object. Prints what it deletes first.
// Usage: node functions/scripts/delete-test-persona.cjs [nameSubstring]
const { initAdminApp, getDb } = require("./admin-app.cjs");
const { getStorage } = require("firebase-admin/storage");

const nameArg = (process.argv[2] || "gym").toLowerCase();

(async () => {
  initAdminApp();
  const db = getDb();
  const snap = await db.collection("user_personas").limit(100).get();
  const match = snap.docs.find((d) =>
    ((d.data().publicConfig || {}).displayName || "").toLowerCase().includes(nameArg),
  );
  if (!match) {
    console.log(`No user_persona whose displayName contains "${nameArg}". Nothing to delete.`);
    process.exit(0);
  }
  const d = match.data();
  const pc = d.publicConfig || {};
  console.log("Deleting persona:");
  console.log("  docId:      ", match.id);
  console.log("  displayName:", pc.displayName);
  console.log("  avatarPath: ", pc.avatarPath || "(none)");

  // Best-effort avatar cleanup (don't fail the delete if storage hiccups).
  if (pc.avatarPath) {
    try {
      await getStorage().bucket().file(pc.avatarPath).delete();
      console.log("  avatar object deleted.");
    } catch (e) {
      console.log("  avatar delete skipped:", e.message);
    }
  }
  await match.ref.delete();
  console.log("Done. Persona doc deleted.");
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
