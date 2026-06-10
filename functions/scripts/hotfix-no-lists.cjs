// TEMPORARY hotfix (2026-06-10): appends a fragment to the live persona prompt
// telling the model to never emit markdown bullets / ordered lists, because the
// app's markdown renderer collapses list items to ~1ch wide (letter-per-line).
// Remove the fragment (key: temp_no_lists_hotfix) once the frontend fix ships.
//
// Usage:
//   node functions/scripts/hotfix-no-lists.cjs          # apply
//   node functions/scripts/hotfix-no-lists.cjs --revert # remove the fragment
const { getDb } = require("./admin-app.cjs");
const { FieldValue } = require("firebase-admin/firestore");

const DOC = "persona_prompts/brainrot_bot_default_prompt";
const KEY = "temp_no_lists_hotfix";
const TEXT = [
  "TEMPORARY FORMATTING RULE (overrides anything above)",
  "",
  "Never use bullet points or ordered/numbered lists of any kind. No markdown list syntax (-, *, 1., 1)), ever. When you would naturally enumerate things, write them as flowing prose or as plain sentences on separate lines without list markers.",
].join("\n");

async function main() {
  const revert = process.argv.includes("--revert");
  const db = getDb();
  const ref = db.doc(DOC);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`${DOC} not found`);
  const fp = snap.get("fragments");
  if (!fp || !Array.isArray(fp.fragments)) throw new Error("doc has no fragments payload");

  const without = fp.fragments.filter((f) => f.key !== KEY);
  const next = revert ? without : [...without, { key: KEY, text: TEXT }];
  if (next.length === fp.fragments.length && !revert && without.length !== fp.fragments.length) {
    console.log("already applied, updating in place");
  }

  await ref.update({
    "fragments.fragments": next,
    fragmentsUpdatedAt: FieldValue.serverTimestamp(),
  });

  const assembled = next
    .map((f) => (f.dynamic ? `<<dynamic:${f.dynamic}>>` : f.text))
    .join(fp.joinWith);
  console.log(revert ? "REVERTED" : "APPLIED", `— ${next.length} fragments`);
  console.log("--- tail of assembled prompt ---");
  console.log(assembled.slice(-600));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
