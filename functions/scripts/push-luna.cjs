// Seeds / re-pushes the LIVE Firestore docs for the Luna first-party persona:
//   - personas/luna_default              (registry doc — the picker + resolver)
//   - persona_prompts/luna_default_prompt (the rendered chat prompt)
//
// Unlike push-prompts.cjs (which UPDATEs the long-existing brainrot docs), Luna
// is new, so this CREATES the docs on first run and re-pushes thereafter. It is
// idempotent: createdAt is set once and preserved across re-pushes; every other
// field is overwritten from the code-canonical render so the live docs can never
// drift from src/personas/luna*.ts.
//
// Source of truth is the compiled lib, so run `npm run build` in functions/
// first. Prompt text is live immediately — no functions deploy needed. Luna's
// media uses the existing media_decider_persona prompt (already live), so no new
// platform_prompts doc is required.
//
// Usage:
//   node functions/scripts/push-luna.cjs --dry-run   # print render, no write
//   node functions/scripts/push-luna.cjs             # create/update live
const { getEncoding } = require("js-tiktoken");
const {
  LUNA_PERSONA_ID,
  LUNA_PERSONA_DOC_PATH,
  LUNA_PERSONA_PROMPT_DOC_PATH,
  LUNA_PERSONA_PROMPT_VERSION,
  LUNA_PERSONA_FRAGMENTS,
  LUNA_PERSONA_PROMPT_DOC,
} = require("../lib/personas/lunaPersonaPrompt.js");
const { LUNA_PUBLIC_CONFIG } = require("../lib/personas/lunaSpec.js");
const { asFragmentedPrompt, assembleFragments } = require("../lib/personas/fragments.js");

const enc = getEncoding("cl100k_base");
const tok = (s) => enc.encode(s).length;

// The three rot levels × emoji on/off — sanity that every variant assembles.
const VARIANTS = [1, 2, 3].flatMap((level) =>
  [true, false].map((emojisEnabled) => ({ level, emojisEnabled })),
);

function printAssembly() {
  if (!asFragmentedPrompt(LUNA_PERSONA_FRAGMENTS)) {
    throw new Error("Luna fragments fail asFragmentedPrompt validation");
  }
  console.log(`persona id: ${LUNA_PERSONA_ID}`);
  console.log(`prompt version: ${LUNA_PERSONA_PROMPT_VERSION}`);
  console.log(`fragments: ${LUNA_PERSONA_FRAGMENTS.fragments.map((f) => f.key).join(", ")}`);
  console.log(`mediaDeciderKey: ${LUNA_PERSONA_PROMPT_DOC.mediaDeciderKey}`);
  console.log(`\nmediaNotes:\n${LUNA_PERSONA_PROMPT_DOC.mediaNotes}\n`);
  for (const ctx of VARIANTS) {
    const persona = assembleFragments(LUNA_PERSONA_FRAGMENTS, ctx);
    console.log(
      `  rot=${ctx.level} emojis=${ctx.emojisEnabled ? "on " : "off"} -> ~${tok(persona)} tokens`,
    );
  }
}

async function main() {
  printAssembly();
  if (process.argv.includes("--dry-run")) {
    console.log("\nDRY RUN — nothing written");
    return;
  }

  const { getDb } = require("./admin-app.cjs");
  const { FieldValue } = require("firebase-admin/firestore");
  const db = getDb();

  // ── Registry doc ──────────────────────────────────────────────────────────
  // isDefault:false — Luna is an ADDITIVE selectable bot, never the auto-default
  // (Brainrot stays the default). isEnabled:true so the picker + resolver serve
  // her. publicConfig comes straight from LUNA_PUBLIC_CONFIG (single source).
  const personaRef = db.doc(LUNA_PERSONA_DOC_PATH);
  const personaSnap = await personaRef.get();
  await personaRef.set({
    id: LUNA_PERSONA_ID,
    name: LUNA_PUBLIC_CONFIG.displayName,
    slug: "luna",
    description:
      "Luna reads your birth chart and hypes you up, and you still get a real answer.",
    isDefault: false,
    isEnabled: true,
    addedBy: "luna_seed_2026_06_28",
    publicConfig: { ...LUNA_PUBLIC_CONFIG },
    createdAt: personaSnap.exists
      ? personaSnap.get("createdAt")
      : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`\n${personaSnap.exists ? "UPDATED" : "CREATED"} ${LUNA_PERSONA_DOC_PATH}`);

  // ── Persona prompt doc ────────────────────────────────────────────────────
  const promptRef = db.doc(LUNA_PERSONA_PROMPT_DOC_PATH);
  const promptSnap = await promptRef.get();
  await promptRef.set({
    id: "luna_default_prompt",
    personaId: LUNA_PERSONA_ID,
    name: "Luna Persona Prompt",
    version: LUNA_PERSONA_PROMPT_VERSION,
    fragments: LUNA_PERSONA_FRAGMENTS,
    mediaDeciderKey: LUNA_PERSONA_PROMPT_DOC.mediaDeciderKey,
    mediaNotes: LUNA_PERSONA_PROMPT_DOC.mediaNotes,
    isActive: true,
    addedBy: "luna_seed_2026_06_28",
    notes:
      "Code-canonical: pushed from src/personas/lunaPersonaPrompt.ts via push-luna.cjs. " +
      "Do not hand-edit this doc; edit the module and re-push.",
    createdAt: promptSnap.exists
      ? promptSnap.get("createdAt")
      : FieldValue.serverTimestamp(),
    fragmentsUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`${promptSnap.exists ? "UPDATED" : "CREATED"} ${LUNA_PERSONA_PROMPT_DOC_PATH} -> ${LUNA_PERSONA_PROMPT_VERSION} (live immediately)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  });
