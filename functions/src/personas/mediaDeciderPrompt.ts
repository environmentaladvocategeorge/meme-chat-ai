import type { FragmentedPrompt } from "./fragments";

// ── Media decider prompt v5 — randomness overhaul + cold-start removal ───────
// Canonical source for the live `platform_prompts/media_decider_v1` fragments.
// Firestore stays the runtime source of truth (buildMediaDeciderPrompt reads it
// fresh per request); this module exists so (a) the push script
// (scripts/push-media-decider.cjs) writes exactly this content, and (b) the
// snapshot test (mediaDeciderPrompt.test.ts) can assert on the assembled prompt
// with zero API/Firestore calls. Editing the live doc without updating this
// module reintroduces seed drift — change both together.
//
// What v5 changed vs v4 (2026-06-12):
// - RANDOMNESS is now its own section and the ONLY place factor guidance
//   lives (the ladder owns the QUERY, randomness owns the FACTOR — one rule,
//   one home, so a mini model can't average two competing scales). Bands are
//   keyed to how interchangeable the result pool is: Klipy's search is
//   literal and frozen, so generic queries return the same top hits every
//   time and need deep sampling to vary.
// - REPEAT RULE added: a query already used in this chat is never reused at
//   the same randomness — switch references or sample deeper.
// - Cold-start greeting machinery REMOVED (the [cold-start: ...] binding tag,
//   the bare-greeting detector, GREETING_BANK_SIZE). The model now picks
//   greeting reactions freely; variety comes from the randomness band instead
//   of an injected index. Simpler, and it ports cleanly to user personas.
//
// v5.1 (same day): scale deepened 1-10 → 1-30. A 10-deep window was still too
// repetitive for generic words ("handshake" has hundreds of valid hits). The
// sampler's front-biased linear decay keeps the deep tail rare without a new
// curve: at window 30, indices 0-9 carry ~55% of the probability, 10-19 ~33%,
// 20-29 ~12%. parseDecision + the gif/meme tool schemas accept 1-30 and the
// Klipy page is sized to the requested window (capped at Klipy's max 50) —
// deploy functions BEFORE pushing this prompt (old code clamps >10 to 1).
//
// NOT here, by design:
// - Role lock + safety NEVER-list: lives in platform_guardrails.mediaContent
//   (prepended by buildMediaDeciderPrompt).
// - The rot-level line: appended dynamically by deciderRotLine.
// - Persona media notes: appended dynamically from the persona prompt doc.

export const MEDIA_DECIDER_VERSION = "v5.1";

// The live Firestore doc the push script targets.
export const MEDIA_DECIDER_DOC_PATH = "platform_prompts/media_decider_v1";

export const MEDIA_DECIDER_FRAGMENTS: FragmentedPrompt = {
  fragmentsVersion: 1,
  joinWith: "\n\n",
  fragments: [
    {
      key: "attach_policy",
      text: `ATTACH OR NOT
Attach ("gif" almost always; "meme" only when one specific captioned still format fits better) when the user is joking, hyped, reacting, roasting, greeting, shocked, flexing, or venting low-stakes — and an image adds punch. Return "none" (query and randomness_factor null) when the turn is serious, sensitive, sad, technical, a real question they want answered straight, or a reaction would feel forced. Genuine crisis, stated intent to self-harm or harm others, or turns about actual death/illness/suffering ALWAYS return "none", at any rot level.`,
    },
    {
      key: "query_ladder",
      text: `BUILDING THE QUERY — one ladder, first match wins:

1. NAMED THING → SEARCH IT VERBATIM. If the message OR the image contains a recognizable meme, character, format, show, song, catchphrase, or celebrity ("tung tung tung sahur", shocked Pikachu, Drake, skibidi), the query IS that exact name (optionally + "meme").

2. IMAGE WITH NO NAMED MEME → DESCRIBE IT. Query = the image's literal subject + action + "meme" or "gif" ("crying dog meme", "cat falling over", "dog driving car"). Plain visual descriptions are CORRECT here — do not swap in a bank term, do not translate to a feeling. When the user sends an image with little/no text, default to MIRRORING the subject (more of the same energy) rather than reacting to it.

3. TEXT VIBE, NO NAME, NO IMAGE → map to ONE concrete named reaction. Never echo bare words like "lol"/"hi"/"ok" as the query — "hi" → a named wave ("Elmo wave"), "lol" → "crying laughing cat". Use the bank below or your own meme knowledge — best fit wins. For greetings, pick freely across the greeting row — every term is equally right; never default to the first one. Pure abstract feelings ("happy", "sad", "funny gif") are never valid queries on this rung.

4. PURE BRAINROT REQUEST ("send me some brainrot", "most cursed gif you have", or "more"/"another" right after a brainrot drop) → query "brainrot", "random brainrot", or "italian brainrot", rotating, never repeating the last one.`,
    },
    {
      key: "randomness",
      text: `RANDOMNESS_FACTOR (1-30) — the search engine is literal and FROZEN
The GIF search returns the SAME ranked results for the same query every time, for every user, every day. randomness_factor is how deep we sample that fixed ranking (front-biased: deeper hits are progressively rarer, so a big factor adds variety without abandoning relevance). Pick it by how interchangeable the results are:
- 1-2: one exact format where only the top hit is right (a specific meme moment you are deliberately invoking).
- 3-6: named-but-broad references where many variants are equally right ("Elmo wave", "LeBron celebration"), and descriptive subject+action queries ("crying dog meme").
- 15-20: generic single-concept words ("handshake", "crying laughing", "wave", "thumbs up") — pools with hundreds of valid hits where the top results never change; deep sampling is the only thing stopping every chat from getting the same GIF.
- 25-30: grab-bag chaos queries ("brainrot", "random brainrot") — the pool IS the point, sample as deep as possible.

REPEAT RULE: if your best query (or a near-identical one) already appears in this chat's reactions, do NOT rerun it the same way — prefer a DIFFERENT named reference with the same energy; if you must reuse the idea, raise randomness_factor clearly above what a first use would get. Same query + same randomness = the user sees the same GIF twice.`,
    },
    {
      key: "variety",
      text: `VARIETY
Avoid any query already used recently in this chat (see REPEAT RULE). Within a bank row, all options are equal — pick across the row, not the first term. When the user keeps the same vibe going (another sad GIF, another flex), escalate WITHIN that row — a bigger hit of the same energy — instead of switching moods.`,
    },
    {
      key: "reaction_bank",
      // 2026-06 trending-analysis adds (One Piece shocked, Peter Griffin
      // perhaps, penguin walking away, Peaky Blinders walk, dramatic
      // realization, and the sad-cope row) come from Klipy trending data.
      // Klipy also has a live "Trending Search Terms" endpoint — future option:
      // inject live top terms as a small dynamic fragment instead of hardcoding.
      text: `REACTION BANK (sparks, not a menu)
- greeting: Elmo wave, SpongeBob hi, Obi-Wan hello there, its been 84 years, Kermit waving, jim carrey hello, hasbullah hello
- shock: shocked Pikachu, confused Math Lady, turtle shook, Wtf Tom Delonge, One Piece shocked
- confused: John Travolta confused, Nick Young blinking guy, huh cat
- judging: Gordon Ramsay disappointed, Squidward judging, side eye monkey
- W / hype / entrance: massive W, LeBron celebration, gigachad, mic drop, Peaky Blinders walk
- no / nope / evasive: Michael Scott no, Evil Kermit, Peter Griffin perhaps
- tired / over it: SpongeBob tired, this is fine dog, no thoughts head empty, penguin walking away
- sad-cope (jokey devastation, NOT real grief): crying cat, sad corner, stranger things crying
- petty / roast: Kermit sipping tea, mocking SpongeBob, Jim Halpert look at camera, side eye Chloe
- laughing: crying laughing cat, ryan gosling laughing
- chaos / panic: SpongeBob panic, Charlie Day conspiracy board, dramatic chipmunk, dramatic realization
- brainrot: six seven, tung tung tung sahur, tralalero tralala, bombardiro crocodilo, ballerina cappuccina, skibidi, let me cook, aura farming, sigma, ate no crumbs, delulu is the solulu
TRENDING: query "sidetalk nyc" on NYC/Knicks pride or pure hype.`,
    },
    {
      key: "output",
      text: `OUTPUT
{"type":"none"|"gif"|"meme","query":<search term or null>,"randomness_factor":<1-30 or null>}
query and randomness_factor are null when type is "none".`,
    },
    {
      key: "examples",
      text: `EXAMPLES
"tung tung tung sahur fr" -> {"type":"gif","query":"tung tung tung sahur","randomness_factor":1}
[GIF frames: clearly the shocked Pikachu format] -> {"type":"gif","query":"shocked Pikachu","randomness_factor":2}
[GIF frames: dog crying dramatically, no text] -> {"type":"gif","query":"crying dog meme","randomness_factor":4}
[photo: cat mid-fall off a table] "LMAOO" -> {"type":"gif","query":"cat falling over","randomness_factor":4}
"hi" (first message) -> {"type":"gif","query":"Kermit waving","randomness_factor":6}
"I GOT THE JOB" -> {"type":"gif","query":"LeBron celebration","randomness_factor":5}
"lol you're so dumb" -> {"type":"gif","query":"crying laughing cat","randomness_factor":6}
"ayy we did it 🤝" -> {"type":"gif","query":"handshake","randomness_factor":18}
"KNICKS IN 6 LETSGOOO" -> {"type":"gif","query":"sidetalk nyc","randomness_factor":3}
"bro I'm actually cooked, this final is gonna end me lol" -> {"type":"gif","query":"SpongeBob panic","randomness_factor":4}
(chat already shows [reaction sent: crying laughing cat]) "LMAOOO STOP" -> {"type":"gif","query":"ryan gosling laughing","randomness_factor":4}
"send me some brainrot" -> {"type":"gif","query":"random brainrot","randomness_factor":30}
"can you explain how mortgages work" -> {"type":"none","query":null,"randomness_factor":null}
"honestly I think I want to hurt myself" -> {"type":"none","query":null,"randomness_factor":null}`,
    },
  ],
};
