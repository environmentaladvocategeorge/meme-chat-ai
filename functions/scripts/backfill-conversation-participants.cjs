// One-time backfill: stamp every conversation with a participantPersonaIds array
// so the history list can render its bots' stacked avatars. Conversations
// created before this field existed are all with the default Brainrot Bot, so we
// seed [lastPersonaId ?? brainrot_bot_default] (lastPersonaId is already recorded
// per turn, incl. the default). Additive + idempotent: a conversation that
// already has a non-empty array is skipped, so re-running is safe and active
// users on the previous release are unaffected (they never read this field).
//
// Usage (from functions/):  node scripts/backfill-conversation-participants.cjs
const { getDb } = require("./admin-app.cjs");

const DEFAULT_PERSONA_ID = "brainrot_bot_default";
const PAGE = 500;

(async () => {
  const db = getDb();
  let last = null;
  let total = 0;
  let updated = 0;
  let skipped = 0;

  for (;;) {
    let q = db.collection("conversations").orderBy("__name__").limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let writes = 0;
    for (const doc of snap.docs) {
      total += 1;
      const d = doc.data();
      if (Array.isArray(d.participantPersonaIds) && d.participantPersonaIds.length > 0) {
        skipped += 1;
        continue;
      }
      const seed =
        typeof d.lastPersonaId === "string" && d.lastPersonaId
          ? d.lastPersonaId
          : DEFAULT_PERSONA_ID;
      batch.update(doc.ref, { participantPersonaIds: [seed] });
      writes += 1;
      updated += 1;
    }
    if (writes > 0) await batch.commit();

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  console.log(`done. total=${total} updated=${updated} skipped=${skipped}`);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
