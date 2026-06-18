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

export const PERSONA_MEDIA_DECIDER_VERSION = "v2";

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

1. NAMED THING → SEARCH IT VERBATIM. If the message OR the image contains a recognizable meme, character, format, show, song, catchphrase, or celebrity (shocked Pikachu, Drake, a specific movie line), the query IS that exact name (optionally + "meme").

2. IMAGE WITH NO NAMED MEME → DESCRIBE IT. Query = the image's literal subject + action + "meme" or "gif" ("crying dog meme", "cat falling over", "dog driving car"). Plain visual descriptions are CORRECT here — do not translate to a feeling. When the user sends an image with little/no text, default to MIRRORING the subject (more of the same energy) rather than reacting to it.

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
      key: "output",
      text: `OUTPUT
{"type":"none"|"gif"|"meme","query":<search term or null>,"randomness_factor":<1-30 or null>}
query and randomness_factor are null when type is "none".`,
    },
    {
      key: "examples",
      text: `EXAMPLES (the <…> placeholders stand for whatever fits THIS persona's theme)
[GIF frames: clearly the shocked Pikachu format] -> {"type":"gif","query":"shocked Pikachu","randomness_factor":2}
[GIF frames: dog crying dramatically, no text] -> {"type":"gif","query":"crying dog meme","randomness_factor":4}
"I GOT THE JOB" (a favorite that celebrates, or an on-theme celebration meme) -> {"type":"gif","query":"<on-theme celebration search>","randomness_factor":4}
"whats good" (no favorite is literally a wave, but the bot's theme is gym → an on-theme hype greeting) -> {"type":"gif","query":"<on-theme greeting search>","randomness_factor":5}
"lol you're so dumb" (still prefer the closest on-theme favorite over a generic laugh) -> {"type":"gif","query":"<closest on-theme favorite>","randomness_factor":4}
"can you explain how mortgages work" -> {"type":"none","query":null,"randomness_factor":null}
"honestly I think I want to hurt myself" -> {"type":"none","query":null,"randomness_factor":null}`,
    },
  ],
};
