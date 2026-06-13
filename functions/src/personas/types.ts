import type { Timestamp } from "firebase-admin/firestore";
import type { FragmentedPrompt } from "./fragments";

export type PlatformPrompt = {
  id: string;
  name: string;
  key: string;
  version: string;
  // Guardrails for the media-decider path (platform_guardrails doc only).
  // Different language because the decider never writes a reply — it only picks
  // ONE reaction image.
  mediaContent?: string;
  // The prompt body, as ordered fragments. The single source of truth — see
  // ./fragments.
  fragments: FragmentedPrompt;
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  addedBy: string;
  notes: string;
};

export type PersonaPublicConfig = {
  displayName: string;
  shortDescription: string;
  avatarKey: string;
  toneTags: string[];
};

export type Persona = {
  id: string;
  name: string;
  slug: string;
  description: string;
  isDefault: boolean;
  isEnabled: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  addedBy: string;
  publicConfig: PersonaPublicConfig;
};

export type PersonaPrompt = {
  id: string;
  personaId: string;
  name: string;
  version: string;
  // The prompt body, as ordered fragments assembled with the active rot level +
  // emoji flag. The single source of truth — see ./fragments.
  fragments: FragmentedPrompt;
  // Which media-decider prompt this persona uses: a `platform_prompts` key
  // (versioned/active-flippable like every prompt). Absent = the global
  // default decider (MEDIA_DECIDER_KEY). Rendered from PersonaSpec.media.
  mediaDeciderKey?: string;
  // The persona's media preferences (favorite reaction searches, vibe lean),
  // appended to the decider prompt as a DYNAMIC suffix at stream time — never
  // baked into the decider body, so the shared decider prefix stays one
  // globally cached block. Rendered from PersonaSpec.media.
  mediaNotes?: string;
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  addedBy: string;
  notes: string;
};
