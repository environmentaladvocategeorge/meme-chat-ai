// One-off backfill: re-render the `mediaNotes` field on existing user_personas
// docs using the CURRENT renderer, so personas saved before the header reframe
// ("PERSONA MEDIA PREFERENCES (vibe only…)" → "THIS PERSONA'S MEDIA — your
// primary query pool…") pick up the new wording without the user re-saving.
//
// Only `mediaNotes` is touched — fragments/publicConfig/moderation are left
// exactly as stored (the persona prompt renderer itself didn't change). A doc
// whose note already matches, or that has none, is skipped.
//
// Source of truth is the compiled lib, so run `npm run build` in functions/
// first. Writes live immediately.
//
// Usage:
//   node functions/scripts/backfill-user-persona-media-notes.cjs --dry-run
//   node functions/scripts/backfill-user-persona-media-notes.cjs
const { getDb } = require("./admin-app.cjs");
const { FieldValue } = require("firebase-admin/firestore");
const { toPersonaSpec } = require("../lib/personas/userPersonas.js");
const { renderPersonaPromptDoc } = require("../lib/personas/personaSpec.js");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = getDb();
  const all = await db.collection("user_personas").get();
  console.log(`scanning ${all.size} user_personas doc(s)\n`);

  let changed = 0;
  for (const d of all.docs) {
    const data = d.data();
    const rendered = renderPersonaPromptDoc(
      toPersonaSpec(d.id, data.input),
      data.publicConfig,
    );
    const next = rendered.mediaNotes; // may be undefined (no media config)
    const prev = data.mediaNotes;
    if ((prev ?? null) === (next ?? null)) {
      console.log(`= ${d.id} (${data.publicConfig?.displayName}) — unchanged`);
      continue;
    }
    changed++;
    console.log(`~ ${d.id} (${data.publicConfig?.displayName})`);
    console.log(`   old: ${prev ? prev.split("\n")[0] : "(none)"}`);
    console.log(`   new: ${next ? next.split("\n")[0] : "(none)"}`);
    if (!dryRun) {
      await d.ref.update({
        mediaNotes: next ?? FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
  console.log(`\n${dryRun ? "DRY RUN — " : ""}${changed} doc(s) ${dryRun ? "would change" : "updated"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  });
