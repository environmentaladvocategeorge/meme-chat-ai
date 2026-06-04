import type { Timestamp } from "firebase-admin/firestore";

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
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  addedBy: string;
  notes: string;
};
