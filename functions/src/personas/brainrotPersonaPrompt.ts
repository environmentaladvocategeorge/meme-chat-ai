import { BRAINROT_PERSONA_SPEC } from "./brainrotSpec";
import type { FragmentedPrompt } from "./fragments";
import {
  renderPersonaPromptDoc,
  type RenderedPersonaPromptDoc,
} from "./personaSpec";

// ── Brainrot Bot persona prompt — code-canonical source ─────────────────────
// Canonical source for the live `persona_prompts/brainrot_bot_default_prompt`
// fragments. Firestore stays the runtime source of truth (resolvePersonaForStream
// reads it fresh per request); this module exists so (a) the push script
// (scripts/push-prompts.cjs) writes exactly this content, (b) the invariant
// tests (promptInvariants.test.ts) can assert on the assembled prompt with
// zero Firestore calls, and (c) every prompt change is a reviewable PR diff
// instead of a console edit. Editing the live doc without updating the source
// modules reintroduces seed drift — change here, then push.
//
// v4 (2026-06-12): the hand-written fragment literal became a rendered
// PersonaSpec — content lives in ./brainrotSpec, structure in ./personaSpec
// (the template every future persona, including user-built ones, renders
// through). The rendered fragments are BYTE-IDENTICAL to v3 — pinned by
// brainrotSpecRender.test.ts against a frozen v3 literal and by the
// promptInvariants golden snapshots — so pushing v4 changes nothing the model
// sees, and 1.0.7 clients are unaffected. v3 (2026-06-11) moved the per-turn
// word-bank rotation + safety recap into a post-history note
// (personas/perTurnNote.ts) for prefix caching; v2 was the mini-optimized
// rewrite. The pre-rewrite baseline lives in
// prompt-snapshots/BASELINE-pre-prompt-optimization.json.
//
// LAYOUT CONTRACT (enforced by promptInvariants.test.ts): this prompt is FULLY
// static per (rot level, emoji toggle) variant — six cacheable prefixes, with
// rot_level_block last for recency. Never add per-turn-varying text; it
// belongs in perTurnNote.ts.

export const BRAINROT_PERSONA_PROMPT_VERSION = "v4-spec-rendered";

// The live Firestore doc the push script targets.
export const BRAINROT_PERSONA_PROMPT_DOC_PATH =
  "persona_prompts/brainrot_bot_default_prompt";

// The full doc-level render: fragments plus the optional media-decider config
// (mediaDeciderKey/mediaNotes). Brainrot's spec sets no media config, so this
// is fragments-only — the push script deletes the fields off the live doc so
// it can never drift from the code-canonical render.
export const BRAINROT_PERSONA_PROMPT_DOC: RenderedPersonaPromptDoc =
  renderPersonaPromptDoc(BRAINROT_PERSONA_SPEC);

export const BRAINROT_PERSONA_FRAGMENTS: FragmentedPrompt =
  BRAINROT_PERSONA_PROMPT_DOC.fragments;
