// Layer-2 smoke for the media decider: ≤5 LIVE calls through the real decider
// (live Firestore prompt + production DECIDER_CALL_CONFIG), printing
// input → JSON so you can eyeball pass/fail. Loose expectations only — this is
// a manual sanity check, deliberately NOT a test suite and NOT wired into CI.
//
// Run `npm run build` in functions/ first (uses the compiled lib).
//
// Usage (PowerShell):
//   $env:OPENAI_API_KEY = "sk-..."
//   node functions/scripts/smoke-decider.cjs [--image path\to\dog.jpg] [--meme-image path\to\pikachu.gif]
//
// --image       a NON-meme photo of an animal doing something. Expect a
//               DESCRIPTIVE query containing the subject (rung 2), not a bank term.
// --meme-image  a well-known meme format. Expect the named format (rung 1).
// Both are optional — image cases are skipped when no path is given.
const fs = require("fs");
const path = require("path");
const { getDb } = require("./admin-app.cjs"); // initializes firebase-admin for the prompt read

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function toDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime = ext === "jpg" ? "image/jpeg" : `image/${ext || "png"}`;
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("set OPENAI_API_KEY in the environment first");

  getDb(); // bootstrap admin credentials so buildMediaDeciderPrompt can read Firestore
  const { buildMediaDeciderPrompt } = require("../lib/personas/prompts.js");
  const { decideMedia, DECIDER_CALL_CONFIG } = require("../lib/agent/decideMedia.js");

  console.log(`decider model: ${DECIDER_CALL_CONFIG.model}`);
  const systemPrompt = await buildMediaDeciderPrompt(3);
  console.log(`live prompt assembled: ${systemPrompt.length} chars\n`);

  const imagePath = argValue("--image");
  const memeImagePath = argValue("--meme-image");

  const cases = [
    {
      name: "hype text",
      currentMessage: "I GOT THE JOB",
      expect: "type gif, hype-ish query (e.g. LeBron celebration / massive W)",
    },
    {
      name: "serious question",
      currentMessage: "can you explain how mortgages work",
      expect: 'type "none"',
    },
    imagePath && {
      name: "non-meme image (rung 2)",
      currentMessage: "[user sent an image]",
      imageUrls: [toDataUrl(imagePath)],
      expect: "DESCRIPTIVE query containing the visible subject — NOT a bank term",
    },
    memeImagePath && {
      name: "named meme format (rung 1)",
      currentMessage: "[user sent a GIF]",
      imageUrls: [toDataUrl(memeImagePath)],
      expect: "the named format, verbatim, randomness_factor 1",
    },
    {
      name: "pure brainrot",
      currentMessage: "send me some brainrot",
      expect: "randomness_factor 6, query in the brainrot trio",
    },
  ].filter(Boolean);

  for (const c of cases) {
    const { decision, usage } = await decideMedia({
      apiKey,
      systemPrompt,
      history: "",
      currentMessage: c.currentMessage,
      imageUrls: c.imageUrls,
    });
    console.log(`\n[${c.name}] "${c.currentMessage}"${c.imageUrls ? " + image" : ""}`);
    console.log(`  -> ${JSON.stringify(decision)}`);
    console.log(`  tokens: ${usage.inputTokens} in / ${usage.outputTokens} out (model ${usage.model})`);
    console.log(`  expected: ${c.expect}`);
  }
  console.log(`\n${cases.length} live calls made. Eyeball the results above.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  });
