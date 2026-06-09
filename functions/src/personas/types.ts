import type { Timestamp } from "firebase-admin/firestore";
import type { FragmentedPrompt } from "./fragments";

export type PlatformPrompt = {
  id: string;
  name: string;
  key: string;
  version: string;
  // Guardrails for the conversational (persona) path.
  content: string;
  // Guardrails for the media-decider path. Different language because the
  // decider never writes a reply — it only picks ONE reaction image. Optional
  // for backward-compat; the decider falls back to MEDIA_GUARDRAILS_FALLBACK.
  mediaContent?: string;
  // Optional fragmented form of `content` (media_decider doc). When present and
  // valid it's assembled in place of `content`; otherwise `content` is used. See
  // ./fragments.
  fragments?: FragmentedPrompt;
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
  content: string;
  // Optional fragmented form of `content`. When present and valid it's assembled
  // (with the active rot level + emoji flag) in place of `content`; otherwise the
  // legacy `content` path runs. See ./fragments.
  fragments?: FragmentedPrompt;
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  addedBy: string;
  notes: string;
};
