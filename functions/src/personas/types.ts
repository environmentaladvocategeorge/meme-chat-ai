import type { Timestamp } from "firebase-admin/firestore";

export type PlatformPrompt = {
  id: string;
  name: string;
  key: string;
  version: string;
  content: string;
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
