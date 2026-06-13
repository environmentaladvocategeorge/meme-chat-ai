// LIVE smoke for the persona moderation gate: runs our OWN content — the
// Brainrot Bot persona spec and the assembled media-decider prompt — through
// the full three-gate PersonaModerationService N times (default 10) and
// requires every run to pass. This is the false-positive check: both texts are
// dense with meta-safety language ("never sexualize...", the decider's
// NEVER-list) that category models can mistake for the content it prohibits,
// and the nano gate is nondeterministic — repeated runs measure its stability.
//
// Run `npm run build` in functions/ first (uses the compiled lib). No
// Firestore access — both texts come from the code-canonical modules (verified
// byte-identical to live by push-prompts --verify).
//
// Usage (PowerShell):
//   $env:OPENAI_API_KEY = "sk-..."   # or rely on functions/.secret.local
//   node functions/scripts/smoke-persona-moderation.cjs [--runs 10]
const fs = require("fs");
const path = require("path");

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const secretPath = path.join(__dirname, "..", ".secret.local");
  if (fs.existsSync(secretPath)) {
    const line = fs
      .readFileSync(secretPath, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("OPENAI_API_KEY="));
    if (line) {
      const value = line.slice("OPENAI_API_KEY=".length).trim().replace(/^"|"$/g, "");
      if (value) return value;
    }
  }
  throw new Error("set OPENAI_API_KEY in the environment or functions/.secret.local");
}

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const apiKey = loadApiKey();
  const runs = Number(argValue("--runs", "10"));

  const {
    PersonaModerationService,
    buildPersonaModerationText,
  } = require("../lib/moderation/personaModeration.js");
  const { BRAINROT_PERSONA_SPEC } = require("../lib/personas/brainrotSpec.js");
  const {
    PLATFORM_GUARDRAILS_MEDIA_CONTENT,
  } = require("../lib/personas/platformGuardrailsPrompt.js");
  const { MEDIA_DECIDER_FRAGMENTS } = require("../lib/personas/mediaDeciderPrompt.js");
  const { assembleFragments } = require("../lib/personas/fragments.js");

  const service = new PersonaModerationService({ apiKey });

  // The decider prompt exactly as the static cached prefix ships it: media
  // guardrails + decider fragments (rot 3 = the spiciest variant; the rot line
  // suffix is frequency-only and carries no moderatable content).
  const deciderText = `${PLATFORM_GUARDRAILS_MEDIA_CONTENT}\n\n${assembleFragments(
    MEDIA_DECIDER_FRAGMENTS,
    { level: 3, emojisEnabled: true },
  )}`;

  const personaText = buildPersonaModerationText({ spec: BRAINROT_PERSONA_SPEC });
  console.log(
    `brainrot persona doc: ${personaText.length} chars | media decider prompt: ${deciderText.length} chars | runs: ${runs}\n`,
  );

  const fmt = (r) => {
    const gateBits = r.gates
      .map((g) => `${g.gate}=${g.pass ? "pass" : "FAIL"}@${g.certainty.toFixed(2)}${g.reason ? `(${g.reason})` : ""}`)
      .join(" ");
    return `${r.pass ? "PASS" : "FAIL"} certainty=${(r.certainty * 100).toFixed(0)}% [${gateBits}]`;
  };

  let failures = 0;
  for (let i = 1; i <= runs; i++) {
    const [persona, decider] = await Promise.all([
      service.moderate({ spec: BRAINROT_PERSONA_SPEC }),
      service.moderateText(deciderText, "media_decider_prompt"),
    ]);
    if (!persona.pass) failures++;
    if (!decider.pass) failures++;
    console.log(`run ${String(i).padStart(2)}: brainrot ${fmt(persona)}`);
    console.log(`        decider  ${fmt(decider)}`);
  }

  console.log(
    failures === 0
      ? `\nALL ${runs} RUNS PASSED for both documents`
      : `\n${failures} FAILURE(S) — the gate rejects our own content; tune before shipping`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
