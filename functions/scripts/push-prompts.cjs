// Pushes the code-canonical chat prompts to the LIVE Firestore docs:
//   - persona_prompts/brainrot_bot_default_prompt  (src/personas/brainrotPersonaPrompt.ts)
//   - platform_prompts/platform_guardrails         (src/personas/platformGuardrailsPrompt.ts,
//     fragments + mediaContent)
//
// Source of truth is the compiled lib, so run `npm run build` in functions/
// first. Prompt edits are live immediately — no functions deploy needed for the
// prompt text itself. STANDING RULE: if a change introduces a new fragment
// shape (e.g. a new `dynamic` kind), deploy the functions code FIRST, then run
// this — asFragmentedPrompt rejects unknown shapes and prompt resolution
// throws, so pushing first is an outage.
//
// Rollback: restore the docs' `fragments` / `mediaContent` / `version` from a
// snapshot (node functions/scripts/pull-prompts.cjs to take one; the
// pre-migration baseline is prompt-snapshots/BASELINE-pre-prompt-optimization.json).
//
// Usage:
//   node functions/scripts/push-prompts.cjs --verify <snapshot.json>  # diff modules vs snapshot, no write
//   node functions/scripts/push-prompts.cjs --dry-run                 # print assembled prompts, no write
//   node functions/scripts/push-prompts.cjs                           # write live
const { getEncoding } = require("js-tiktoken");
const {
  BRAINROT_PERSONA_FRAGMENTS,
  BRAINROT_PERSONA_PROMPT_VERSION,
  BRAINROT_PERSONA_PROMPT_DOC_PATH,
} = require("../lib/personas/brainrotPersonaPrompt.js");
const {
  PLATFORM_GUARDRAILS_FRAGMENTS,
  PLATFORM_GUARDRAILS_MEDIA_CONTENT,
  PLATFORM_GUARDRAILS_VERSION,
  PLATFORM_GUARDRAILS_DOC_PATH,
} = require("../lib/personas/platformGuardrailsPrompt.js");
const { asFragmentedPrompt, assembleFragments } = require("../lib/personas/fragments.js");

const enc = getEncoding("cl100k_base");
const tok = (s) => enc.encode(s).length;

// All six runtime variants — used for dry-run token reporting and as a sanity
// pass that every variant assembles without throwing.
const VARIANTS = [1, 2, 3].flatMap((level) =>
  [true, false].map((emojisEnabled) => ({ level, emojisEnabled })),
);

function printAssembly() {
  for (const fp of [BRAINROT_PERSONA_FRAGMENTS, PLATFORM_GUARDRAILS_FRAGMENTS]) {
    if (!asFragmentedPrompt(fp)) {
      throw new Error("fragments fail asFragmentedPrompt validation");
    }
  }
  console.log(`persona version: ${BRAINROT_PERSONA_PROMPT_VERSION}`);
  console.log(
    `persona fragments: ${BRAINROT_PERSONA_FRAGMENTS.fragments.map((f) => f.key).join(", ")}`,
  );
  console.log(`guardrails version: ${PLATFORM_GUARDRAILS_VERSION}`);
  for (const ctx of VARIANTS) {
    const platform = assembleFragments(PLATFORM_GUARDRAILS_FRAGMENTS, ctx);
    const persona = assembleFragments(BRAINROT_PERSONA_FRAGMENTS, ctx);
    const full = `${platform}\n\nActive persona prompt:\n${persona}`;
    console.log(
      `  rot=${ctx.level} emojis=${ctx.emojisEnabled ? "on " : "off"} -> ~${tok(full)} tokens (platform ~${tok(platform)}, persona ~${tok(persona)})`,
    );
  }
}

// --verify <snapshot.json>: deep-compare the code modules against a pulled
// snapshot. Proves the migration is byte-exact (or shows precisely what
// changed) without touching Firestore.
function verifyAgainstSnapshot(snapshotPath) {
  const fs = require("fs");
  const snap = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  let failures = 0;

  const diffFragments = (label, liveFp, codeFp) => {
    const liveByKey = new Map(liveFp.fragments.map((f) => [f.key, f]));
    const codeByKey = new Map(codeFp.fragments.map((f) => [f.key, f]));
    const liveKeys = liveFp.fragments.map((f) => f.key);
    const codeKeys = codeFp.fragments.map((f) => f.key);
    if (liveKeys.join("|") !== codeKeys.join("|")) {
      failures++;
      console.log(`MISMATCH ${label} fragment order/keys:`);
      console.log(`  live: ${liveKeys.join(", ")}`);
      console.log(`  code: ${codeKeys.join(", ")}`);
    }
    for (const key of new Set([...liveKeys, ...codeKeys])) {
      const a = liveByKey.get(key);
      const b = codeByKey.get(key);
      if (!a || !b) continue;
      for (const field of ["text", "textWhenEmojisOff", "requires", "dynamic"]) {
        if ((a[field] ?? null) !== (b[field] ?? null)) {
          failures++;
          console.log(`MISMATCH ${label}.${key}.${field}`);
          if (typeof a[field] === "string" && typeof b[field] === "string") {
            const max = Math.max(a[field].length, b[field].length);
            for (let i = 0; i < max; i++) {
              if (a[field][i] !== b[field][i]) {
                console.log(
                  `  first diff at char ${i}: live ${JSON.stringify(a[field].slice(i, i + 40))} vs code ${JSON.stringify(b[field].slice(i, i + 40))}`,
                );
                break;
              }
            }
          }
        }
      }
    }
    if (liveFp.joinWith !== codeFp.joinWith) {
      failures++;
      console.log(`MISMATCH ${label}.joinWith`);
    }
  };

  const personaDoc = snap.persona_prompts.find(
    (d) => `persona_prompts/${d.id}` === BRAINROT_PERSONA_PROMPT_DOC_PATH,
  );
  const guardrailsDoc = snap.platform_prompts.find(
    (d) => `platform_prompts/${d.id}` === PLATFORM_GUARDRAILS_DOC_PATH,
  );
  if (!personaDoc || !guardrailsDoc) throw new Error("snapshot missing expected docs");

  diffFragments("persona", personaDoc.data.fragments, BRAINROT_PERSONA_FRAGMENTS);
  diffFragments("guardrails", guardrailsDoc.data.fragments, PLATFORM_GUARDRAILS_FRAGMENTS);
  if (guardrailsDoc.data.mediaContent !== PLATFORM_GUARDRAILS_MEDIA_CONTENT) {
    failures++;
    console.log("MISMATCH guardrails.mediaContent");
  }

  if (failures === 0) {
    console.log("VERIFIED: code modules match the snapshot byte-for-byte");
  } else {
    console.log(`\n${failures} mismatch(es) — expected if the modules have moved past this snapshot`);
    process.exitCode = 1;
  }
}

async function main() {
  const verifyIdx = process.argv.indexOf("--verify");
  if (verifyIdx !== -1) {
    const snapshotPath = process.argv[verifyIdx + 1];
    if (!snapshotPath) throw new Error("--verify requires a snapshot path");
    verifyAgainstSnapshot(snapshotPath);
    return;
  }

  printAssembly();
  if (process.argv.includes("--dry-run")) {
    console.log("\nDRY RUN — nothing written");
    return;
  }

  const { getDb } = require("./admin-app.cjs");
  const { FieldValue } = require("firebase-admin/firestore");
  const db = getDb();

  const personaRef = db.doc(BRAINROT_PERSONA_PROMPT_DOC_PATH);
  const personaSnap = await personaRef.get();
  if (!personaSnap.exists) throw new Error(`${BRAINROT_PERSONA_PROMPT_DOC_PATH} not found`);
  console.log(`\ncurrent persona prompt version: ${personaSnap.get("version")}`);
  await personaRef.update({
    fragments: BRAINROT_PERSONA_FRAGMENTS,
    version: BRAINROT_PERSONA_PROMPT_VERSION,
    notes:
      "Code-canonical: pushed from src/personas/brainrotPersonaPrompt.ts via push-prompts.cjs. " +
      "Do not hand-edit this doc; edit the module and re-push.",
    fragmentsUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`PUSHED ${BRAINROT_PERSONA_PROMPT_DOC_PATH} -> ${BRAINROT_PERSONA_PROMPT_VERSION}`);

  const guardrailsRef = db.doc(PLATFORM_GUARDRAILS_DOC_PATH);
  const guardrailsSnap = await guardrailsRef.get();
  if (!guardrailsSnap.exists) throw new Error(`${PLATFORM_GUARDRAILS_DOC_PATH} not found`);
  console.log(`current guardrails version: ${guardrailsSnap.get("version")}`);
  await guardrailsRef.update({
    fragments: PLATFORM_GUARDRAILS_FRAGMENTS,
    mediaContent: PLATFORM_GUARDRAILS_MEDIA_CONTENT,
    version: PLATFORM_GUARDRAILS_VERSION,
    notes:
      "Code-canonical: pushed from src/personas/platformGuardrailsPrompt.ts via push-prompts.cjs. " +
      "Do not hand-edit this doc; edit the module and re-push.",
    fragmentsUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`PUSHED ${PLATFORM_GUARDRAILS_DOC_PATH} -> ${PLATFORM_GUARDRAILS_VERSION} (live immediately)`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  });
