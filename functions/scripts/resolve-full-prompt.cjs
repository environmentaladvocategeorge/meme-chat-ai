// Read-only: assemble the FULL system prompt that buildSystemPromptForStream
// produces for a given user persona, exactly as the streaming agent would —
// live platform_guardrails shell (Firestore) + the persona's stored fragments,
// resolved at a rot level with emojis on. Also prints the post-history per-turn
// note for completeness.
//
// Usage: node functions/scripts/resolve-full-prompt.cjs [nameSubstring] [rotLevel]
const { getDb } = require("./admin-app.cjs");
const { assembleFragments } = require("../lib/personas/fragments.js");
const { buildPerTurnNote } = require("../lib/personas/perTurnNote.js");

const nameArg = (process.argv[2] || "gym").toLowerCase();
const level = Number(process.argv[3] || 2);

(async () => {
  const db = getDb();

  const pg = await db
    .collection("platform_prompts")
    .where("key", "==", "platform_guardrails")
    .where("isActive", "==", true)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (pg.empty) throw new Error("no active platform_guardrails prompt");
  const platformFragments = pg.docs[0].data().fragments;

  const snap = await db.collection("user_personas").limit(100).get();
  const match = snap.docs.find((d) =>
    ((d.data().publicConfig || {}).displayName || "").toLowerCase().includes(nameArg),
  );
  if (!match) throw new Error(`no user persona matching "${nameArg}"`);
  const personaFragments = match.data().fragments;

  const ctx = { level, emojisEnabled: true };
  const platformContent = assembleFragments(platformFragments, ctx);
  const personaContent = assembleFragments(personaFragments, ctx);
  const systemPrompt = `${platformContent}\n\nActive persona prompt:\n${personaContent}`;

  console.log("############################################################");
  console.log(`# FULL SYSTEM PROMPT — ${(match.data().publicConfig || {}).displayName}`);
  console.log(`# rot level ${level}, emojis ON`);
  console.log(`# platform shell ~${platformContent.length} chars | persona ~${personaContent.length} chars`);
  console.log("############################################################\n");
  console.log(systemPrompt);
  console.log("\n\n############################################################");
  console.log("# POST-HISTORY PER-TURN NOTE (appended after the conversation)");
  console.log("############################################################\n");
  console.log(buildPerTurnNote());
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
