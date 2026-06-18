import type { PickedAvatar } from "@/services/firebase/uploadPersonaAvatar";
import {
  LIMITS,
  NEW_PERSONA_FORM,
  normalizePersonaForm,
  type PersonaFormValues,
} from "./personaForm";
import { findTemplate } from "./personaTemplates";

// ── Persona drafts (client domain) ───────────────────────────────────────────
// A work-in-progress persona, saved LOCALLY (never the cloud — see
// store/storage.ts PersonaDraftsStorage). The avatar lives as a device-local
// image URI until publish, so abandoned drafts cost nothing (no upload, no
// moderation). A user keeps at most MAX_PERSONA_DRAFTS at once.

export const MAX_PERSONA_DRAFTS = 3;

export type PersonaDraftAvatar = {
  // Local file URI from the image picker. Uploaded + moderated only at publish.
  localUri: string;
  width?: number;
  height?: number;
};

// A reaction GIF/meme the user picked from Klipy. Only the `name` (the Klipy
// item's title) is ever sent to the backend — it becomes a `media.pills` entry
// the decider re-searches. `previewUrl` is kept LOCALLY for the picked-tray
// thumbnail and is never published. The form's `mediaPills` mirrors the names.
export type MediaPick = {
  name: string;
  previewUrl: string;
};

export type PersonaDraft = {
  id: string;
  // Epoch ms of the last edit — drives "Draft saved" + most-recent ordering.
  updatedAt: number;
  // Which template seeded it, or null when started from scratch.
  templateId: string | null;
  // The wizard step the user last had open (resume where they left off).
  step: number;
  values: PersonaFormValues;
  avatar: PersonaDraftAvatar | null;
  // Picked reaction GIFs/memes (names + local thumbnails). Mirrors the form's
  // `mediaPills` by name; the thumbnails let the picked tray render on reload.
  mediaPicks: MediaPick[];
  // The last batch of AI-generated avatar candidates (local files), kept so the
  // pair survives closing and reopening the creator — not just the one the user
  // selected. Re-generating REPLACES this list (old candidates are never kept).
  generatedAvatars: PickedAvatar[];
};

export function newDraftId(): string {
  return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Creates a fresh draft from a template id (seeding its values) or from scratch
// (empty form) when no/unknown id is given.
export function createDraft(templateId?: string | null): PersonaDraft {
  const template = templateId ? findTemplate(templateId) : undefined;
  return {
    id: newDraftId(),
    updatedAt: Date.now(),
    templateId: template ? template.id : null,
    step: 0,
    // A fresh-from-scratch persona starts from NEW_PERSONA_FORM, where every
    // "let {bot} decide" toggle is OFF — the user opts into each one. A template
    // seeds its authored values instead.
    values: template ? { ...template.values } : { ...NEW_PERSONA_FORM },
    avatar: null,
    mediaPicks: [],
    generatedAvatars: [],
  };
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function normalizeAvatar(value: unknown): PersonaDraftAvatar | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.localUri !== "string" || v.localUri.length === 0) return null;
  const avatar: PersonaDraftAvatar = { localUri: v.localUri };
  if (typeof v.width === "number") avatar.width = v.width;
  if (typeof v.height === "number") avatar.height = v.height;
  return avatar;
}

// Defensive parse of the picked reactions list off disk. Drops entries without
// a usable name, defaults a missing thumbnail to "" (the tray falls back to a
// text chip), and caps the list at the media-pills limit.
function normalizeMediaPicks(value: unknown): MediaPick[] {
  if (!Array.isArray(value)) return [];
  const picks: MediaPick[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.name !== "string" || v.name.trim().length === 0) continue;
    picks.push({
      name: v.name,
      previewUrl: typeof v.previewUrl === "string" ? v.previewUrl : "",
    });
  }
  return picks.slice(0, LIMITS.mediaPillsMax);
}

// Defensive parse of the persisted avatar-candidate pair. Drops entries without
// a usable local URI and caps at two (the generator always makes two).
function normalizeGeneratedAvatars(value: unknown): PickedAvatar[] {
  if (!Array.isArray(value)) return [];
  const out: PickedAvatar[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.localUri !== "string" || v.localUri.length === 0) continue;
    out.push({
      localUri: v.localUri,
      width: typeof v.width === "number" ? v.width : 0,
      height: typeof v.height === "number" ? v.height : 0,
    });
  }
  return out.slice(0, 2);
}

// Defensive parse of a single persisted draft, or null when unusable (no id).
export function normalizeDraft(value: unknown): PersonaDraft | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return null;
  return {
    id: v.id,
    updatedAt: asNumber(v.updatedAt, 0),
    templateId: typeof v.templateId === "string" ? v.templateId : null,
    step: Math.max(0, Math.floor(asNumber(v.step, 0))),
    values: normalizePersonaForm(v.values),
    avatar: normalizeAvatar(v.avatar),
    mediaPicks: normalizeMediaPicks(v.mediaPicks),
    generatedAvatars: normalizeGeneratedAvatars(v.generatedAvatars),
  };
}

// Defensive parse of the persisted draft list: drops malformed entries, orders
// most-recent first, and enforces the cap (keeping the newest).
export function normalizeDrafts(value: unknown): PersonaDraft[] {
  if (!Array.isArray(value)) return [];
  const drafts = value
    .map(normalizeDraft)
    .filter((d): d is PersonaDraft => d !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return drafts.slice(0, MAX_PERSONA_DRAFTS);
}

// True when a NEW draft can be created without first deleting one.
export function canCreateDraft(drafts: PersonaDraft[]): boolean {
  return drafts.length < MAX_PERSONA_DRAFTS;
}

// Upserts a draft into the list (replace by id, else prepend), refreshes its
// updatedAt, re-orders most-recent first, and enforces the cap.
export function upsertDraft(drafts: PersonaDraft[], draft: PersonaDraft): PersonaDraft[] {
  const stamped = { ...draft, updatedAt: Date.now() };
  const rest = drafts.filter((d) => d.id !== draft.id);
  return [stamped, ...rest]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PERSONA_DRAFTS);
}

export function removeDraft(drafts: PersonaDraft[], id: string): PersonaDraft[] {
  return drafts.filter((d) => d.id !== id);
}
