// Pushes the USER-PERSONA media-decider prompt to the LIVE
// platform_prompts/media_decider_persona_v1 doc. Source of truth is
// src/personas/personaMediaDeciderPrompt.ts (read here from the compiled lib),
// so run `npm run build` in functions/ first.
//
// UNLIKE push-media-decider.cjs (which .update()s an existing doc), this script
// SELF-CREATES the doc on first run: the persona decider is new, so there's
// nothing to update yet. getActivePlatformPrompt resolves by (key, isActive)
// ordered by createdAt, and isPlatformPrompt requires id/name/key/version/
// fragments/isActive/addedBy/notes — so all of those are written here.
//
// ROLLOUT ORDER: deploy the functions code BEFORE running this. New code points
// user personas at `media_decider_persona`; until this doc exists+active,
// buildMediaDeciderPrompt falls back to the brainrot default (safe). Pushing
// this before the code is deployed is also safe (nothing resolves the key yet).
//
// Rollback: set isActive=false on the doc (resolution falls back to the brainrot
// default decider) and/or restore fragments from a pull-prompts.cjs snapshot.
//
// Usage:
//   node functions/scripts/push-persona-media-decider.cjs --dry-run   # print, no write
//   node functions/scripts/push-persona-media-decider.cjs             # write live
const { getEncoding } = require("js-tiktoken");
const { getDb } = require("./admin-app.cjs");
const { FieldValue } = require("firebase-admin/firestore");
const {
  PERSONA_MEDIA_DECIDER_FRAGMENTS,
  PERSONA_MEDIA_DECIDER_VERSION,
  PERSONA_MEDIA_DECIDER_DOC_PATH,
  PERSONA_MEDIA_DECIDER_KEY,
} = require("../lib/personas/personaMediaDeciderPrompt.js");
const { asFragmentedPrompt, assembleFragments } = require("../lib/personas/fragments.js");

const DOC_ID = PERSONA_MEDIA_DECIDER_DOC_PATH.split("/").pop();

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Verify reassembly before touching anything (workflow rule: always check the
  // joined text against the intended prompt before writing).
  if (!asFragmentedPrompt(PERSONA_MEDIA_DECIDER_FRAGMENTS)) {
    throw new Error("PERSONA_MEDIA_DECIDER_FRAGMENTS fails asFragmentedPrompt validation");
  }
  const assembled = assembleFragments(PERSONA_MEDIA_DECIDER_FRAGMENTS, {
    level: 3,
    emojisEnabled: true,
  });
  const tokens = getEncoding("cl100k_base").encode(assembled).length;
  console.log(`key: ${PERSONA_MEDIA_DECIDER_KEY}`);
  console.log(`version: ${PERSONA_MEDIA_DECIDER_VERSION}`);
  console.log(`fragments: ${PERSONA_MEDIA_DECIDER_FRAGMENTS.fragments.map((f) => f.key).join(", ")}`);
  console.log(`assembled: ~${tokens} tokens\n`);
  console.log("--- assembled prompt (decider fragments only; guardrails + persona notes + rot line are added at request time) ---");
  console.log(assembled);
  console.log("--- end ---\n");

  if (dryRun) {
    console.log("DRY RUN — nothing written");
    return;
  }

  const db = getDb();
  const ref = db.doc(PERSONA_MEDIA_DECIDER_DOC_PATH);
  const snap = await ref.get();
  const isNew = !snap.exists;
  console.log(isNew ? "doc does not exist — creating" : `current doc version: ${snap.get("version")}`);

  await ref.set(
    {
      id: DOC_ID,
      name: "User persona media decider",
      key: PERSONA_MEDIA_DECIDER_KEY,
      version: PERSONA_MEDIA_DECIDER_VERSION,
      fragments: PERSONA_MEDIA_DECIDER_FRAGMENTS,
      isActive: true,
      addedBy: "push-persona-media-decider.cjs",
      notes:
        "Code-canonical: pushed from src/personas/personaMediaDeciderPrompt.ts. " +
        "Favorites-first decider for user-built personas (no brainrot bank). " +
        "Do not hand-edit; edit the module and re-push.",
      fragmentsUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      // createdAt only on first create — getActivePlatformPrompt orders by it.
      ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
    },
    { merge: true },
  );
  console.log(
    `PUSHED ${PERSONA_MEDIA_DECIDER_DOC_PATH} -> ${PERSONA_MEDIA_DECIDER_VERSION} (live immediately)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  });
