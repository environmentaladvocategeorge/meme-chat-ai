// Pushes the v4 "ladder" media-decider prompt to the LIVE
// platform_prompts/media_decider_v1 doc. The fragment content's source of
// truth is src/personas/mediaDeciderPrompt.ts (read here from the compiled
// lib), so run `npm run build` in functions/ first. Prompt edits are live
// immediately — no functions deploy needed for the prompt itself.
//
// IMPORTANT ordering for the v4 rollout: deploy the functions code BEFORE
// running this. The v4 greeting row has 7 terms while pre-v4 deployed code
// injects cold-start indexes up to 13 (GREETING_BANK_SIZE=14) — pushing the
// prompt first would make indexes 7-13 dangle. New code against the old
// prompt is safe (0-6 is valid in the 14-term row).
//
// Rollback: take a snapshot first (node functions/scripts/pull-prompts.cjs)
// and restore the doc's `fragments`/`version` from it if needed.
//
// Usage:
//   node functions/scripts/push-media-decider.cjs --dry-run   # print, no write
//   node functions/scripts/push-media-decider.cjs             # write live
const { getEncoding } = require("js-tiktoken");
const { getDb } = require("./admin-app.cjs");
const { FieldValue } = require("firebase-admin/firestore");
const {
  MEDIA_DECIDER_FRAGMENTS,
  MEDIA_DECIDER_VERSION,
  MEDIA_DECIDER_DOC_PATH,
} = require("../lib/personas/mediaDeciderPrompt.js");
const { asFragmentedPrompt, assembleFragments } = require("../lib/personas/fragments.js");

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Verify reassembly before touching anything (workflow rule: always check
  // the joined text against the intended prompt before writing).
  if (!asFragmentedPrompt(MEDIA_DECIDER_FRAGMENTS)) {
    throw new Error("MEDIA_DECIDER_FRAGMENTS fails asFragmentedPrompt validation");
  }
  const assembled = assembleFragments(MEDIA_DECIDER_FRAGMENTS, {
    level: 3,
    emojisEnabled: true,
  });
  const tokens = getEncoding("cl100k_base").encode(assembled).length;
  console.log(`version: ${MEDIA_DECIDER_VERSION}`);
  console.log(`fragments: ${MEDIA_DECIDER_FRAGMENTS.fragments.map((f) => f.key).join(", ")}`);
  console.log(`assembled: ~${tokens} tokens\n`);
  console.log("--- assembled prompt (decider fragments only; guardrails + rot line are added at request time) ---");
  console.log(assembled);
  console.log("--- end ---\n");

  if (dryRun) {
    console.log("DRY RUN — nothing written");
    return;
  }

  const db = getDb();
  const ref = db.doc(MEDIA_DECIDER_DOC_PATH);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`${MEDIA_DECIDER_DOC_PATH} not found`);
  console.log(`current doc version: ${snap.get("version")}`);

  await ref.update({
    fragments: MEDIA_DECIDER_FRAGMENTS,
    version: MEDIA_DECIDER_VERSION,
    notes:
      "v4 ladder rewrite (2026-06-10): 4-rung query ladder w/ image-description rung, " +
      "trimmed bank + merged brainrot row + trending adds, image few-shots. " +
      "Pushed from src/personas/mediaDeciderPrompt.ts via push-media-decider.cjs.",
    fragmentsUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`PUSHED ${MEDIA_DECIDER_DOC_PATH} -> ${MEDIA_DECIDER_VERSION} (live immediately)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  });
