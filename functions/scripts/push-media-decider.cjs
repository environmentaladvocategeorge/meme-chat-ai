// Pushes the media-decider prompt to the LIVE
// platform_prompts/media_decider_v1 doc. The fragment content's source of
// truth is src/personas/mediaDeciderPrompt.ts (read here from the compiled
// lib), so run `npm run build` in functions/ first. Prompt edits are live
// immediately — no functions deploy needed for the prompt itself.
//
// IMPORTANT ordering for the v5 rollout: deploy the functions code BEFORE
// running this. The v5 prompt tells the model to use randomness_factor up to
// 10, while pre-v5 deployed code clamps anything above 6 back down to 1 —
// pushing the prompt first would collapse every high-band pick to the top
// hit. New code against the old prompt is safe (1-6 is inside 1-10).
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
      "v7 trending refresh (2026-06-27): headline trend swapped sidetalk nyc -> scuba " +
      "(word-triggered SCUBAAA/scuba, usable out of context + as a greeting; search " +
      "scuba / scuba cat / scuba fox / scuba dance / tung tung scuba); sidetalk nyc " +
      "demoted into the W/hype reaction bank; greeting row rotated (hey you / whats " +
      "good / elmo door up front, Elmo wave + SpongeBob hi to the back); added lighter " +
      "'also popular (US)' pick Love Island USA. " +
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
