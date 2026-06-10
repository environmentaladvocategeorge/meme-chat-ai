// Phase 0: snapshot the live persona/platform/persona-prompt docs from Firestore
// so we can (a) work from the real prompt text and (b) roll back after Phase 7.
// Read-only. Uses Application Default Credentials (same as the deployed runtime).
const { getEncoding } = require("js-tiktoken");
const fs = require("fs");
const path = require("path");
const { getDb } = require("./admin-app.cjs");

const enc = getEncoding("cl100k_base");
const tok = (s) => (typeof s === "string" && s.length ? enc.encode(s).length : 0);

(async () => {
  const db = getDb();
  const out = {};
  for (const col of ["personas", "persona_prompts", "platform_prompts"]) {
    const snap = await db.collection(col).get();
    out[col] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    console.log(`${col}: ${snap.size} docs`);
    for (const doc of out[col]) {
      const fp = doc.data.fragments;
      const c = Array.isArray(fp?.fragments)
        ? fp.fragments.map((f) => f.text ?? "").join(fp.joinWith ?? "\n\n")
        : undefined;
      if (typeof c === "string") {
        console.log(
          `  - ${doc.id}  active=${doc.data.isActive ?? "-"}  key=${doc.data.key ?? doc.data.personaId ?? "-"}  ~${tok(c)} tokens`,
        );
      }
    }
  }

  const dir = path.join(__dirname, "..", "..", "prompt-snapshots");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `prompts-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nwrote snapshot -> ${file}`);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
