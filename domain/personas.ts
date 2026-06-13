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

// The lean read-model the picker renders: one user persona's public face. The
// full spec/prompt never reaches the client — only this store-facing config.
export type UserPersonaSummary = {
  id: string;
  displayName: string;
  avatarKey: string;
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
    !isNonEmptyString(c.avatarKey) ||
    !Array.isArray(c.toneTags)
  ) {
    return null;
  }
  return {
    id,
    displayName: c.displayName,
    avatarKey: c.avatarKey,
    shortDescription: c.shortDescription,
    toneTags: c.toneTags.filter(isNonEmptyString),
  };
}
