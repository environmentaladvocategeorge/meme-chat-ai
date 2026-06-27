import type { PlanId } from "@/domain/billing";

// ── Personas (client domain) ─────────────────────────────────────────────────
// Pure, render-free logic behind the persona picker: the default-persona
// identity, the per-plan cap (mirrors the backend userPersonaCap), the
// selection resolver (with the deleted-elsewhere fallback), and the Firestore
// doc → summary mapper. React state lives in store/personas.ts; this module
// holds the parts worth unit-testing.

// The implicit first-party persona. It is NOT stored in user_personas — it's
// the default every user starts on and falls back to. The display NAME is
// localized at render time (t("chat.agentName")), so this layer stays i18n-free
// and only deals in the id + the default/user distinction.
export const DEFAULT_PERSONA_ID = "brainrot_bot_default";

// Hard ceiling on a user's saved personas. Mirrors the backend
// MAX_USER_PERSONAS; the free tier gets 1, every paid tier gets the full 10.
export const MAX_USER_PERSONAS = 10;

export function personaCap(plan: PlanId): number {
  return plan === "free" ? 1 : MAX_USER_PERSONAS;
}

// The most distinct bots one conversation may hold. Past this, switching to a
// brand-new bot and trying to send is blocked — the user is nudged to pick a
// bot already in the thread or start a fresh conversation. Five bots in a
// single thread is already a lot, and the cap keeps a conversation legible
// (it's also a natural seam for smarter multi-bot routing later).
export const MAX_PERSONAS_PER_CONVERSATION = 5;

// The distinct bots that have actually taken part in a conversation: the
// authoritative set from the conversation doc (participantPersonaIds) unioned
// with the personas behind any loaded agent replies. A reply with no personaId
// predates per-bot tracking, so it counts as the default bot.
export function collectParticipantPersonaIds(
  participantPersonaIds: readonly string[],
  agentPersonaIds: readonly (string | undefined)[],
): Set<string> {
  const ids = new Set<string>(participantPersonaIds);
  for (const id of agentPersonaIds) ids.add(id ?? DEFAULT_PERSONA_ID);
  return ids;
}

// Whether sending as `currentPersonaId` would push the conversation past the
// per-thread bot cap. A bot already in the thread is always allowed (sending as
// it doesn't grow the set); a brand-new bot is blocked once the thread already
// holds `max` distinct bots.
export function isPersonaLimitReached(
  participants: ReadonlySet<string>,
  currentPersonaId: string,
  max: number = MAX_PERSONAS_PER_CONVERSATION,
): boolean {
  if (participants.has(currentPersonaId)) return false;
  return participants.size >= max;
}

// The lean read-model the picker renders: one user persona's public face. The
// full spec/prompt never reaches the client — only this store-facing config.
export type UserPersonaSummary = {
  id: string;
  displayName: string;
  // First-party/preset avatar key (legacy). User-built personas instead carry
  // an uploaded image at avatarUrl; either may be absent (→ monogram).
  avatarKey?: string;
  avatarUrl?: string;
  shortDescription: string;
  toneTags: string[];
};

// What the header pill + hero render: either the localized default, or a
// concrete user persona.
export type ResolvedPersona =
  | { kind: "default" }
  | { kind: "user"; persona: UserPersonaSummary };

// Resolves the selected id against the hydrated list. A non-default id that
// isn't present (deleted on another device, not yet hydrated) silently falls
// back to the default — mirroring the backend's ownership fallback so the UI
// can never strand the user on a persona that no longer exists.
export function resolveSelectedPersona(
  selectedId: string,
  personas: UserPersonaSummary[],
): ResolvedPersona {
  if (selectedId !== DEFAULT_PERSONA_ID) {
    const match = personas.find((p) => p.id === selectedId);
    if (match) return { kind: "user", persona: match };
  }
  return { kind: "default" };
}

// Like resolveSelectedPersona, but DISTINGUISHES a since-deleted bot ("unknown")
// instead of folding it into the default — so the history's stacked avatars and
// the per-message chat avatars can render a "?" for a bot that's gone. A missing
// id counts as the default (pre-tracking messages were all the default bot).
export function resolvePersonaSlot(
  id: string | undefined,
  personas: UserPersonaSummary[],
): ResolvedPersona | "unknown" {
  if (!id || id === DEFAULT_PERSONA_ID) return { kind: "default" };
  const match = personas.find((p) => p.id === id);
  return match ? { kind: "user", persona: match } : "unknown";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// Shapes a user_personas doc's publicConfig into a summary, or null when the
// doc is malformed. Defensive read-back: the backend validated on write (it's
// the source of truth), so this just drops anything that doesn't fit rather
// than re-enforcing policy — same stance as conversations.mapImages.
export function mapPersonaDoc(id: string, data: unknown): UserPersonaSummary | null {
  if (!data || typeof data !== "object") return null;
  const config = (data as Record<string, unknown>).publicConfig;
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  if (
    !isNonEmptyString(c.displayName) ||
    !isNonEmptyString(c.shortDescription) ||
    !Array.isArray(c.toneTags)
  ) {
    return null;
  }
  // The avatar is optional: a user persona carries an uploaded image (avatarUrl),
  // a legacy preset key (avatarKey), or neither (the picker renders a monogram).
  // Requiring one here is what silently dropped every uploaded-avatar persona.
  return {
    id,
    displayName: c.displayName,
    ...(isNonEmptyString(c.avatarKey) ? { avatarKey: c.avatarKey } : {}),
    ...(isNonEmptyString(c.avatarUrl) ? { avatarUrl: c.avatarUrl } : {}),
    shortDescription: c.shortDescription,
    toneTags: c.toneTags.filter(isNonEmptyString),
  };
}
