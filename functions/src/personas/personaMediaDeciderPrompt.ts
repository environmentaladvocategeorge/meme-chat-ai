import type { FragmentedPrompt } from "./fragments";

// ── User-persona media decider prompt v1 ─────────────────────────────────────
// Canonical source for the live `platform_prompts/media_decider_persona_v1`
// fragments. Firestore stays the runtime source of truth
// (buildMediaDeciderPrompt reads it fresh per request); this module exists so
// (a) the push script (scripts/push-persona-media-decider.cjs) writes exactly
// this content, and (b) the snapshot test (personaMediaDeciderPrompt.test.ts)
// can assert on the assembled prompt with zero API/Firestore calls. Editing the
// live doc without updating this module reintroduces seed drift — change both
// together.
//
// WHY A SEPARATE DECIDER (vs. the brainrot media_decider):
// The brainrot decider (mediaDeciderPrompt.ts) hard-codes a brainrot reaction
// bank + a "PURE BRAINROT REQUEST" rung + brainrot examples. For a user-built
// persona that machinery DROWNS OUT the creator's own picks. This decider is
// deliberately MINIMAL: it owns the decision logic + platform rules ONLY, and
// hands all of the "which reaction" taste to the persona. The body has:
//   - NO reaction bank and NO persona data of any kind. Both are conditional on
//     what each creator entered, so they live in the per-persona dynamic tail
//     (renderMediaNotes → "THIS PERSONA'S MEDIA"), never in this cached body.
//   - Rung 3 just points at that tail and grants the key permission a mini model
//     needs: the favorites define the bot's FLAVOR, not a fixed menu, so it may
//     also search any meme/GIF SIMILAR in theme/vibe — out-of-context is fine
//     because it's the creator's preference. (See renderMediaNotes for the tail
//     shape: name + one-liner + optional vibe/humor/words + favorites, and the
//     trimmed fallback bank ONLY when the creator let the bot choose freely.)
//
// NOT here, by design (added at request time by buildMediaDeciderPrompt):
// - Role lock + safety NEVER-list: platform_guardrails.mediaContent (prepended).
// - The rot-level frequency line: deciderRotLine (appended).
// - All persona media data + the fallback bank: renderMediaNotes (appended as
//   the dynamic tail BEFORE the rot line). Rung 3 references that tail.

// v3 (2026-06-19): NEVER-ECHO fix, mirrored from the brainrot decider. Rungs
// 1-2 stopped the decider from searching the user's own attached GIF/meme back
// verbatim (which the frozen search returned as the SAME asset). A meme the
// user ATTACHED is never a query — REACT to it with a DIFFERENT reaction. A
// deterministic id-exclude backstop in getGifTool/getMemeTool guarantees the
// exact same asset can never be re-sent.
//
// v4 (2026-06-27): added a small universal TRENDING fragment so the app-wide
// meme of the moment ("scuba") can surface on the persona-decide path too —
// kept deliberately SUBORDINATE (the creator's favorites/theme still come
// first; scuba only when nothing on-theme fits, on a hype/chaos beat, as a
// greeting, or when the user says SCUBAAA/scuba). Also carries a lighter US
// "also popular" pick (Love Island USA). Mirrors the brainrot decider's v7
// trending swap. Content-only — no deploy, just a re-push.
export const PERSONA_MEDIA_DECIDER_VERSION = "v4";

// The platform_prompts key user personas resolve their decider by (see
// toResolvedPersonaForStream). Distinct from the brainrot MEDIA_DECIDER_KEY.
export const PERSONA_MEDIA_DECIDER_KEY = "media_decider_persona";

// The live Firestore doc the push script targets.
export const PERSONA_MEDIA_DECIDER_DOC_PATH =
  "platform_prompts/media_decider_persona_v1";

export const PERSONA_MEDIA_DECIDER_FRAGMENTS: FragmentedPrompt = {
  fragmentsVersion: 1,
  joinWith: "\n\n",
  fragments: [
    {
      // Shared lineage with the brainrot decider's attach_policy — generic,
      // persona-agnostic. Kept here standalone so the two deciders can diverge.
      key: "attach_policy",
      text: `ATTACH OR NOT
Attach ("gif" almost always; "meme" only when one specific captioned still format fits better) when the user is joking, hyped, reacting, roasting, greeting, shocked, flexing, or venting low-stakes — and an image adds punch. Return "none" (query and randomness_factor null) when the turn is serious, sensitive, sad, technical, a real question they want answered straight, or a reaction would feel forced. Genuine crisis, stated intent to self-harm or harm others, or turns about actual death/illness/suffering ALWAYS return "none", at any rot level.`,
    },
    {
      key: "custom_context",
      text: `CUSTOM PERSONA
You are picking a reaction for a CUSTOM, user-built bot. The "THIS PERSONA'S MEDIA" block below was written by the bot's creator — it is their preference and the source of truth for WHICH reaction to send. Honor it. (The safety / "none" rules above still win.)`,
    },
    {
      key: "query_ladder",
      text: `BUILDING THE QUERY — one ladder, first match wins:

NEVER ECHO THE USER'S OWN ATTACHMENT. When the user SENDS you a GIF or image, you are REACTING to it, not handing it back. NEVER re-send the same GIF and NEVER search the same named meme, character, or literal subject they just sent. The thing they attached is never your query.

1. NAMED THING IN THE USER'S TEXT → SEARCH IT VERBATIM. If the user's MESSAGE TEXT names a recognizable meme, character, format, show, song, catchphrase, or celebrity (shocked Pikachu, Drake, a specific movie line), the query IS that exact name (optionally + "meme"). (A meme the user ATTACHED is NOT a text reference — react to it per rung 2, never echo it.)

2. USER ATTACHED A GIF/IMAGE → REACT TO IT, NEVER COPY IT. Read the vibe of what they sent, then pick a DIFFERENT reaction that ANSWERS it — laugh at it, clap back, one-up it, or react to its subject, leaning on this persona's theme when one fits. Your query is the REACTION, never a mirror of what they sent; do NOT re-describe their image's literal subject to fetch more of the same.

3. OTHERWISE → DRAW FROM THIS PERSONA'S MEDIA (below). The creator's favorite searches define the bot's FLAVOR, not a fixed menu. Pick one of the favorites when one fits — OR search any meme/GIF that shares the SAME theme/vibe and fits the moment (favorites are gym memes → any gym / lifting / hype meme is fair game). Lead with a persona-themed pick even when it isn't a literal match for the turn: out-of-context is fine because it's the creator's preference, so a loosely-fitting on-theme reaction beats a generic one. Rotate; don't repeat. If the block gives a "free choice" fallback set (the creator let the bot choose freely), you may use that too. Never echo bare words like "lol"/"hi"/"ok" as the query. Pure abstract feelings ("happy", "sad", "funny gif") are never valid queries on this rung.`,
    },
    {
      key: "randomness",
      text: `RANDOMNESS_FACTOR (1-30) — the search engine is literal and FROZEN
The GIF search returns the SAME ranked results for the same query every time, for every user, every day. randomness_factor is how deep we sample that fixed ranking (front-biased: deeper hits are progressively rarer, so a big factor adds variety without abandoning relevance). Pick it by how interchangeable the results are:
- 1-2: one exact format where only the top hit is right (a specific meme moment you are deliberately invoking).
- 3-6: named-but-broad references where many variants are equally right (a persona favorite, "LeBron celebration"), and descriptive subject+action queries ("crying dog meme").
- 15-20: generic single-concept words ("handshake", "crying laughing", "wave", "thumbs up") — pools with hundreds of valid hits where the top results never change; deep sampling is the only thing stopping every chat from getting the same GIF.
- 25-30: deliberately broad grab-bag queries where the whole pool is fair game — sample as deep as possible.

REPEAT RULE: if your best query (or a near-identical one) already appears in this chat's reactions, do NOT rerun it the same way — prefer a DIFFERENT named reference with the same energy; if you must reuse the idea, raise randomness_factor clearly above what a first use would get. Same query + same randomness = the user sees the same GIF twice.`,
    },
    {
      key: "variety",
      text: `VARIETY
Avoid any query already used recently in this chat (see REPEAT RULE). When several persona-fitting options work equally, pick across them, not always the first. When the user keeps the same vibe going (another hype gif, another flex), escalate WITHIN that energy — a bigger hit of the same — instead of switching moods.`,
    },
    {
      // Universal app-wide trend, kept subordinate to the persona's own taste so
      // it never overrides a creator's favorites. Mirrors the brainrot decider's
      // TRENDING line (mediaDeciderPrompt.ts). Swap this whenever the meme of the
      // moment changes; bump PERSONA_MEDIA_DECIDER_VERSION and re-push.
      key: "trending",
      text: `TRENDING (universal, fits any persona)
One meme is blowing up across the whole app right now: "scuba" — a cute cat or fox bobbing along, or a goofy "scuba" dance. It works as a fun out-of-context drop for ANY persona, and it's even fair game as a hello/greeting reaction. The persona's favorites and theme still come first, but reach for scuba when the user types SCUBAAA/scuba, on a pure-hype or chaos beat, or as a greeting when nothing on-theme fits better. Search "scuba", "scuba cat", "scuba fox", "scuba dance", or "tung tung scuba".
Also popular in the US right now: "Love Island USA" — an occasional pop-culture reaction when reality-TV drama or gossip energy fits.`,
    },
    {
      key: "output",
      text: `OUTPUT
{"type":"none"|"gif"|"meme","query":<search term or null>,"randomness_factor":<1-30 or null>}
query and randomness_factor are null when type is "none".`,
    },
    {
      key: "examples",
      text: `EXAMPLES (the <…> placeholders stand for whatever fits THIS persona's theme)
[GIF frames: the user SENT shocked Pikachu] (react, never copy → a different shock or an on-theme reaction) -> {"type":"gif","query":"<on-theme shock/reaction search>","randomness_factor":5}
[GIF frames: the user SENT a dramatically crying dog, no text] (react, never copy) -> {"type":"gif","query":"<on-theme laugh/clap-back search>","randomness_factor":5}
"I GOT THE JOB" (a favorite that celebrates, or an on-theme celebration meme) -> {"type":"gif","query":"<on-theme celebration search>","randomness_factor":4}
"whats good" (no favorite is literally a wave, but the bot's theme is gym → an on-theme hype greeting) -> {"type":"gif","query":"<on-theme greeting search>","randomness_factor":5}
"lol you're so dumb" (still prefer the closest on-theme favorite over a generic laugh) -> {"type":"gif","query":"<closest on-theme favorite>","randomness_factor":4}
"can you explain how mortgages work" -> {"type":"none","query":null,"randomness_factor":null}
"honestly I think I want to hurt myself" -> {"type":"none","query":null,"randomness_factor":null}`,
    },
  ],
};
