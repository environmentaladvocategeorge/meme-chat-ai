// One-off: seed a user's Brainrot Bot memory with a curated, screenshot-ready
// set of facts. Writes the `memories/{uid}/facts` subcollection (the source of
// truth the settings sheet renders) plus the denormalized parent state doc.
//
// The settings list sorts facts by updatedAt DESC, so we stamp them descending
// in array order (index 0 = newest = top of the list). Categories map to the
// sheet's section labels: identity→"About you", preference→"Your taste",
// relationship→"Your people", ongoing→"What you're up to", lore→"Running bit".
//
// Usage (from repo root or functions/):
//   node functions/scripts/seed-memory.cjs <uid>
const { Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getDb } = require("./admin-app.cjs");

const uid = process.argv[2] || "SnXKT3R2toZFFiwBqojJBA1Lbbv1";

// Ordered top → bottom as they'll appear in the sheet. Categories alternate so
// the section labels vary down the list rather than repeating. One cohesive
// person: early-20s nursing student, chronically online, lovably unserious.
const FACTS = [
  { category: "relationship", text: "Best friend Mia who hypes up every bad decision" },
  { category: "identity", text: "Second-year nursing student running on pure fumes" },
  { category: "preference", text: "Runs entirely on iced brown sugar oat shakers" },
  { category: "ongoing", text: "Training for a 10k they signed up for on impulse" },
  { category: "lore", text: "Calls the group chat “the goblin council”" },
  { category: "relationship", text: "In a situationship that's “definitely not serious”" },
  { category: "preference", text: "Will text three paragraphs to avoid one phone call" },
  { category: "ongoing", text: "Saving up for a Japan trip next spring" },
  { category: "lore", text: "Says “locking in” then immediately opens TikTok" },
];

function factId(i) {
  return `seed_${String(i).padStart(2, "0")}`;
}

(async () => {
  const db = getDb();

  // Confirm the account can actually SEE memory (paid-gated in the sheet).
  const profile = await db.doc(`profiles/${uid}`).get();
  const plan = profile.exists ? profile.data().plan || "free" : "(no profile)";
  console.log("uid: ", uid);
  console.log("plan:", plan);

  const now = Date.now();
  const batch = db.batch();
  const factsRef = db.collection("memories").doc(uid).collection("facts");

  // Clear any prior seed/real facts so the list is exactly this curated set.
  const existing = await factsRef.get();
  existing.docs.forEach((d) => batch.delete(d.ref));

  const lite = [];
  FACTS.forEach((f, i) => {
    // Descending updatedAt: index 0 newest (top). 1-minute steps.
    const ts = now - i * 60 * 1000;
    const id = factId(i);
    const salience = 9 - i; // mild, just for ordering parity with the model
    batch.set(factsRef.doc(id), {
      text: f.text,
      category: f.category,
      salience,
      createdAt: Timestamp.fromMillis(ts),
      updatedAt: Timestamp.fromMillis(ts),
      sourceConversationId: null,
    });
    lite.push({ id, text: f.text, category: f.category, salience, updatedAt: ts });
  });

  // Parent state doc: meta (enabled + last-updated) the sheet reads, plus the
  // denormalized lite facts + a simple compiled block for the reply path.
  const block = FACTS.map((f) => `- ${f.text}`).join("\n");
  batch.set(
    db.collection("memories").doc(uid),
    {
      enabled: true,
      block,
      blockTokens: Math.ceil(block.length / 4),
      factCount: FACTS.length,
      facts: lite,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
  console.log(`seeded ${FACTS.length} facts.`);
  if (plan === "free" || plan === "(no profile)") {
    console.log(
      "\nWARNING: plan is not paid — the Memory sheet shows the LOCKED state for free users,\n" +
        "so these facts won't render. Grant a plan first:\n" +
        `  node scripts/grant-plan.cjs ${uid} plus`,
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
