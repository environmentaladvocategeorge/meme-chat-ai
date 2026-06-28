import type { FragmentedPrompt } from "./fragments";
import { LUNA_PERSONA_SPEC, LUNA_PUBLIC_CONFIG } from "./lunaSpec";
import {
  renderPersonaPromptDoc,
  type RenderedPersonaPromptDoc,
} from "./personaSpec";

// ── Luna persona prompt — code-canonical source ─────────────────────────────
// Canonical source for the live `persona_prompts/luna_default_prompt` doc.
// Mirrors brainrotPersonaPrompt.ts: Firestore stays the runtime source of truth
// (resolvePersonaForStream reads it fresh per request); this module exists so
// (a) the push script (scripts/push-luna.cjs) writes exactly this content, and
// (b) tests can assert on the rendered doc with zero Firestore calls. Editing
// the live doc without updating this module reintroduces seed drift — change
// here, then push.
//
// Unlike Brainrot, Luna's spec DOES set a media config, so the rendered doc
// carries mediaDeciderKey (the minimal persona decider) + mediaNotes (her
// favorites + lean, grounded by LUNA_PUBLIC_CONFIG). buildMediaDeciderPrompt
// appends mediaNotes as a dynamic suffix to the shared persona-decider body.

export const LUNA_PERSONA_PROMPT_VERSION = "v1";

// The live Firestore docs the push script targets.
export const LUNA_PERSONA_ID = "luna_default";
export const LUNA_PERSONA_DOC_PATH = "personas/luna_default";
export const LUNA_PERSONA_PROMPT_DOC_PATH = "persona_prompts/luna_default_prompt";

// The full doc-level render: fragments + the media-decider config
// (mediaDeciderKey/mediaNotes), grounded by Luna's public config so the media
// note's "this bot is …" line matches the registry doc.
export const LUNA_PERSONA_PROMPT_DOC: RenderedPersonaPromptDoc =
  renderPersonaPromptDoc(LUNA_PERSONA_SPEC, LUNA_PUBLIC_CONFIG);

export const LUNA_PERSONA_FRAGMENTS: FragmentedPrompt =
  LUNA_PERSONA_PROMPT_DOC.fragments;
