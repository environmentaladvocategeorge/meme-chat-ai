// Phase 7: rewrite the live prompts for the nano-decider media pipeline.
//   1. Persona prompt (mini): strip the get_gif/get_meme tool sections + search
//      bank, replace with a short "media is auto-attached" note. Mini has no
//      tools now, so those instructions were dead weight (and confusing).
//   2. New `media_decider` platform prompt: the decision instructions + the
//      search-term bank (relocated from the persona) + a strict JSON contract.
// Snapshots from pull-prompts.cjs are the rollback path. Re-run is idempotent
// for the decider (overwrites the same doc id) and for the persona (markers).
const { Timestamp } = require("firebase-admin/firestore");
const { getEncoding } = require("js-tiktoken");
const { getDb } = require("./admin-app.cjs");

const enc = getEncoding("cl100k_base");
const tok = (s) => (s ? enc.encode(s).length : 0);

const PERSONA_MEDIA_NOTE = [
  "MEDIA (AUTO-ATTACHED, NOT YOUR JOB)",
  "",
  "You have no tools and cannot attach images. A separate system decides whether to send ONE reaction GIF or meme with your reply and picks it for you.",
  "",
  'When the turn includes a note that a GIF or meme is attached (with a short "about"), you may riff on it or ignore it — but never title, describe, link, embed, or announce it ("here’s a gif", "*sends meme*"). The app shows it on its own.',
  "",
  "When there is no such note, just reply text-only. Either way the image is bonus, never the whole answer.",
].join("\n");

// Two new bank terms requested by the user.
const EXTRA_BANK_TERMS = ["invincible are you sure", "superman cape"];

function buildDeciderPrompt(bankTerms) {
  return [
    "You are the reaction-media module for Brainrot Bot, a meme/roast chat bot. Read the conversation and the latest user message, then decide whether the bot’s reply should come with ONE reaction image — and if so, pick the search term.",
    "",
    "WHEN TO ATTACH",
    "- Prefer a GIF (type \"gif\"); animated reactions are richer and search better. Choose a still meme (type \"meme\") only when a specific captioned still format clearly says it better than motion.",
    "- Attach one when the user is joking, hyped, celebrating, reacting, playful, roasting, confused, shocked, greeting, or venting about something low-stakes AND a reaction image genuinely adds something.",
    "- Return type \"none\" on serious, sensitive, technical, emotionally heavy, or crisis turns, when the user just wants a straight answer, or when a reaction would feel forced.",
    "- Be selective: not every turn needs an image, and overusing them kills the punch. The rot-level note below sets how generous to be.",
    "",
    "SEARCH TERMS",
    "- Search recognizable references, characters, shows, actions, or named reactions — NEVER raw feelings. Bad: \"funny gif\", \"reaction\", \"happy\", \"confused\". Good: concrete named references.",
    "- Use a term from the bank, modify one, or write a fresh concrete one that fits the exact message. Don’t always map the same moment to the same term.",
    "- randomness_factor: 1 for an exact/specific reference; 2-3 for a loose or generic query where any top hit lands.",
    "",
    "VISUAL SEARCH EXAMPLE BANK (examples of good search terms, not a decision tree)",
    bankTerms.join("\n"),
    "",
    "OUTPUT",
    "Reply with ONLY this JSON and nothing else:",
    '{"type":"none"|"gif"|"meme","query":<search term string or null>,"randomness_factor":<1-4 or null>}',
    'Set query and randomness_factor to null when type is "none".',
  ].join("\n");
}

function sliceMarker(lines, startsWith) {
  return lines.findIndex((l) => l.trim().startsWith(startsWith));
}

(async () => {
  const db = getDb();

  // ---- 1. read live persona + locate sections ----
  const personaSnap = await db
    .collection("persona_prompts")
    .where("isActive", "==", true)
    .get();
  if (personaSnap.size !== 1) {
    throw new Error(`expected 1 active persona prompt, found ${personaSnap.size}`);
  }
  const personaDoc = personaSnap.docs[0];
  const persona = personaDoc.data().content;
  const lines = persona.split("\n");

  const startIdx = sliceMarker(lines, "ANIMATED GIFS: get_gif");
  const bottomIdx = sliceMarker(lines, "BOTTOM LINE");
  const bankStartIdx = sliceMarker(lines, "six seven"); // first bank term
  if (startIdx < 0 || bottomIdx < 0 || bankStartIdx < 0 || bankStartIdx >= bottomIdx) {
    throw new Error("could not locate media-block markers; aborting (no write)");
  }

  // Pure list of bank terms (relocated to the decider) + the new ones.
  const bankTerms = lines
    .slice(bankStartIdx, bottomIdx)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .concat(EXTRA_BANK_TERMS);

  // ---- 2. build the new persona (media block -> short note) ----
  let newPersona = [
    ...lines.slice(0, startIdx),
    PERSONA_MEDIA_NOTE,
    "",
    ...lines.slice(bottomIdx),
  ].join("\n");
  // Neutralize the intro permission line so mini doesn't try to "send" media.
  newPersona = newPersona.replace(
    /Send reaction GIFs and memes freely[^.]*\./,
    "Reaction GIFs and memes are attached to your replies automatically by a separate system, so lean into that energy in your words but never attach, title, or announce them yourself.",
  );

  const deciderContent = buildDeciderPrompt(bankTerms);

  console.log("persona tokens:", tok(persona), "->", tok(newPersona));
  console.log("decider tokens:", tok(deciderContent), "| bank terms:", bankTerms.length);
  console.log("\n--- new persona MEDIA section ---\n" + PERSONA_MEDIA_NOTE);
  console.log("\n--- decider prompt (head) ---\n" + deciderContent.slice(0, 600) + "\n...");

  // ---- 3. write ----
  await personaDoc.ref.set(
    { content: newPersona, updatedAt: Timestamp.now() },
    { merge: true },
  );
  console.log(`\nupdated persona_prompts/${personaDoc.id}`);

  await db.doc("platform_prompts/media_decider_v1").set({
    id: "media_decider_v1",
    name: "Media Decider v1",
    key: "media_decider",
    version: "v1",
    content: deciderContent,
    isActive: true,
    addedBy: "backend_script",
    notes: "Nano media-decision prompt: decides none/gif/meme + Klipy search term.",
    createdAt: Timestamp.now(),
  });
  console.log("wrote platform_prompts/media_decider_v1 (key=media_decider)");

  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
