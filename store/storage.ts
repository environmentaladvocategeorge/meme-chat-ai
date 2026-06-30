import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CHAT_UI_COLOR_ROLES,
  type ChatThemePreset,
  type ChatUiColorOverrides,
  DEFAULT_BACKGROUND,
  DEFAULT_BUBBLE_STYLE,
  isBackgroundId,
  isBubbleStyleId,
  normalizeHex,
} from "@/domain/customization";
import {
  normalizeDrafts,
  normalizeGeneratedAvatars,
  type PersonaDraft,
} from "@/domain/personaDrafts";
import {
  isIntentValue,
  type IntentValue,
  type OnboardingAnswers,
} from "@/domain/onboarding/script";
import type { PickedAvatar } from "@/services/firebase/uploadPersonaAvatar";

export type Appearance = "system" | "light" | "dark";
export type Language = "system" | "en" | "es" | "fr" | "pt" | "de" | "zh" | "ja" | "hi" | "ru";

export interface PersistedSettings {
  appearance: Appearance;
  language: Language;
  // Paid "App Customization" feature. Stored as preset ids (or "auto").
  // Local-only — never synced to the backend.
  chatBubbleStyle: string;
  chatBackground: string;
  chatUiColors: ChatUiColorOverrides;
  // User-saved whole-look themes (message bubble + background + UI colors),
  // shown in the Customize Chat themes row. Local-only, like the rest of the
  // appearance state. The built-in starters are NOT stored here — they're
  // appended at render time, so this only ever holds the user's own saves.
  chatThemePresets: ChatThemePreset[];
  // The name Brainrot Bot calls the user, captured during onboarding. Mirrored to
  // profiles/{uid} via the updateProfile callable so it survives reinstall;
  // this local copy is the fast read for the UI.
  alias: string;
  // The "what brought you here" answer captured during conversational
  // onboarding. Committed here at finish() (alongside the alias) and read once by
  // the first chat's empty state to seed intent-matched starter prompts.
  // Local-only — never synced to the backend; wiped on sign-out/delete like the
  // rest of settings.
  intent: IntentValue | null;
}

export const MAX_ALIAS_LENGTH = 40;

const SETTINGS_KEY = "app.settings";
const ONBOARDING_KEY = "app.onboarding";

const APPEARANCE_VALUES = new Set<Appearance>(["system", "light", "dark"]);
const LANGUAGE_VALUES = new Set<Language>(["system", "en", "es", "fr", "pt", "de", "zh", "ja", "hi", "ru"]);

export const DEFAULT_SETTINGS: PersistedSettings = {
  appearance: "system",
  language: "system",
  chatBubbleStyle: DEFAULT_BUBBLE_STYLE,
  chatBackground: DEFAULT_BACKGROUND,
  chatUiColors: {},
  chatThemePresets: [],
  alias: "",
  intent: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeChatUiColors(value: unknown): ChatUiColorOverrides {
  if (!isRecord(value)) return {};
  const colors: ChatUiColorOverrides = {};
  for (const role of CHAT_UI_COLOR_ROLES) {
    const color = value[role];
    if (typeof color !== "string") continue;
    const normalized = normalizeHex(color);
    if (normalized) colors[role] = normalized;
  }
  if (!colors.accent && typeof value.accentText === "string") {
    const normalized = normalizeHex(value.accentText);
    if (normalized) colors.accent = normalized;
  }
  if (!colors.subtle) {
    const legacySubtle =
      typeof value.surface === "string"
        ? value.surface
        : typeof value.chatBar === "string"
          ? value.chatBar
          : null;
    const normalized = legacySubtle ? normalizeHex(legacySubtle) : null;
    if (normalized) colors.subtle = normalized;
  }
  return colors;
}

// Each stored preset must carry a resolvable bubble + background; otherwise it's
// dropped. UI colors run through the same normalizer as the live overrides.
function normalizeThemePresets(value: unknown): ChatThemePreset[] {
  if (!Array.isArray(value)) return [];
  const out: ChatThemePreset[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { bubbleStyle, background } = item;
    if (typeof bubbleStyle !== "string" || !isBubbleStyleId(bubbleStyle)) {
      continue;
    }
    if (typeof background !== "string" || !isBackgroundId(background)) continue;
    out.push({
      bubbleStyle,
      background,
      uiColors: normalizeChatUiColors(item.uiColors),
    });
  }
  return out;
}

function normalizeSettings(value: unknown): PersistedSettings {
  if (!isRecord(value)) return DEFAULT_SETTINGS;

  return {
    appearance:
      typeof value.appearance === "string" &&
      APPEARANCE_VALUES.has(value.appearance as Appearance)
        ? (value.appearance as Appearance)
        : DEFAULT_SETTINGS.appearance,
    language:
      typeof value.language === "string" &&
      LANGUAGE_VALUES.has(value.language as Language)
        ? (value.language as Language)
        : DEFAULT_SETTINGS.language,
    chatBubbleStyle:
      typeof value.chatBubbleStyle === "string" &&
      isBubbleStyleId(value.chatBubbleStyle)
        ? value.chatBubbleStyle
        : DEFAULT_SETTINGS.chatBubbleStyle,
    chatBackground:
      typeof value.chatBackground === "string" &&
      isBackgroundId(value.chatBackground)
        ? value.chatBackground
        : DEFAULT_SETTINGS.chatBackground,
    chatUiColors: normalizeChatUiColors(value.chatUiColors),
    chatThemePresets: normalizeThemePresets(value.chatThemePresets),
    alias:
      typeof value.alias === "string"
        ? value.alias.slice(0, MAX_ALIAS_LENGTH)
        : DEFAULT_SETTINGS.alias,
    intent: isIntentValue(value.intent) ? value.intent : DEFAULT_SETTINGS.intent,
  };
}

let pendingSettingsWrite = Promise.resolve();

export const SettingsStorage = {
  async read(): Promise<PersistedSettings> {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      return normalizeSettings(JSON.parse(raw));
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  async write(patch: Partial<PersistedSettings>): Promise<void> {
    pendingSettingsWrite = pendingSettingsWrite
      .then(async () => {
        const current = await SettingsStorage.read();
        await AsyncStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({ ...current, ...patch }),
        );
      })
      .catch(() => {});

    await pendingSettingsWrite;
  },

  async reset(): Promise<void> {
    pendingSettingsWrite = pendingSettingsWrite
      .then(() => AsyncStorage.removeItem(SETTINGS_KEY))
      .catch(() => {});

    await pendingSettingsWrite;
  },
};

interface PersistedOnboarding {
  completed: boolean;
  // The script cursor (index of the turn the user last reached). Persisted on
  // every advance so that leaving the app mid-onboarding resumes where they left
  // off instead of restarting the conversation. Ignored once `completed` is true
  // (a completed account routes straight to /chat and never mounts the flow).
  cursor: number;
  // The personalization captured so far (intent / alias / rotLevel). Persisted
  // alongside the cursor so a resumed session can rebuild the full chat
  // transcript via buildTranscript. Transient resume state only — the durable
  // homes are Settings.alias, Settings.intent, and the chat rot level, all
  // committed at finish(). Wiped on sign-out/delete with the rest of `app.*`.
  answers: OnboardingAnswers;
}

const DEFAULT_ONBOARDING: PersistedOnboarding = {
  completed: false,
  cursor: 0,
  answers: {},
};

function clampCursor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeAnswers(value: unknown): OnboardingAnswers {
  if (!isRecord(value)) return {};
  const out: OnboardingAnswers = {};
  if (isIntentValue(value.intent)) out.intent = value.intent;
  if (typeof value.alias === "string") {
    const alias = value.alias.slice(0, MAX_ALIAS_LENGTH);
    if (alias.length > 0) out.alias = alias;
  }
  if (typeof value.rotLevel === "number" && Number.isFinite(value.rotLevel)) {
    out.rotLevel = Math.min(
      Math.max(Math.round(value.rotLevel), MIN_ROT_LEVEL),
      MAX_ROT_LEVEL,
    );
  }
  return out;
}

let pendingOnboardingWrite = Promise.resolve();

export const OnboardingStorage = {
  async read(): Promise<PersistedOnboarding> {
    try {
      const raw = await AsyncStorage.getItem(ONBOARDING_KEY);
      if (!raw) return DEFAULT_ONBOARDING;
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) return DEFAULT_ONBOARDING;
      return {
        completed: parsed.completed === true,
        cursor: clampCursor(parsed.cursor),
        answers: normalizeAnswers(parsed.answers),
      };
    } catch {
      return DEFAULT_ONBOARDING;
    }
  },

  async write(patch: Partial<PersistedOnboarding>): Promise<void> {
    pendingOnboardingWrite = pendingOnboardingWrite
      .then(async () => {
        const current = await OnboardingStorage.read();
        await AsyncStorage.setItem(
          ONBOARDING_KEY,
          JSON.stringify({ ...current, ...patch }),
        );
      })
      .catch(() => {});

    await pendingOnboardingWrite;
  },

  async reset(): Promise<void> {
    pendingOnboardingWrite = pendingOnboardingWrite
      .then(() => AsyncStorage.removeItem(ONBOARDING_KEY))
      .catch(() => {});

    await pendingOnboardingWrite;
  },
};

// Age gate (device-level, pre-account). Stored under its own key and
// DELIBERATELY excluded from wipeLocalAppData below: deleting the account must
// NOT reset the gate, otherwise an under-16 user could bypass the block by
// deleting their account and re-creating one. This survives sign-out and full
// account deletion; only a fresh reinstall clears it. There is intentionally no
// path that ties this record to a uid.
//
// MIN_AGE and the age math live in @/domain/age (pure + unit-tested); re-exported
// here for the call sites that already import age-gate bits from storage.
export { MIN_AGE } from "@/domain/age";

export type AgeGateStatus = "unset" | "passed" | "blocked";

export interface PersistedAgeGate {
  status: AgeGateStatus;
  // ISO yyyy-mm-dd of the entered date of birth (kept for auditability / a
  // future server-side lie-and-lose check). Null until the gate is answered.
  birthDate: string | null;
}

const AGE_GATE_KEY = "app.ageGate";

const DEFAULT_AGE_GATE: PersistedAgeGate = { status: "unset", birthDate: null };

const AGE_GATE_STATUSES = new Set<AgeGateStatus>(["unset", "passed", "blocked"]);

function normalizeAgeGate(value: unknown): PersistedAgeGate {
  if (!isRecord(value)) return DEFAULT_AGE_GATE;
  const status =
    typeof value.status === "string" &&
    AGE_GATE_STATUSES.has(value.status as AgeGateStatus)
      ? (value.status as AgeGateStatus)
      : "unset";
  return {
    status,
    birthDate: typeof value.birthDate === "string" ? value.birthDate : null,
  };
}

let pendingAgeGateWrite = Promise.resolve();

export const AgeGateStorage = {
  async read(): Promise<PersistedAgeGate> {
    try {
      const raw = await AsyncStorage.getItem(AGE_GATE_KEY);
      if (!raw) return DEFAULT_AGE_GATE;
      return normalizeAgeGate(JSON.parse(raw));
    } catch {
      return DEFAULT_AGE_GATE;
    }
  },

  async write(patch: Partial<PersistedAgeGate>): Promise<void> {
    pendingAgeGateWrite = pendingAgeGateWrite.catch(() => {}).then(async () => {
      const current = await AgeGateStorage.read();
      await AsyncStorage.setItem(
        AGE_GATE_KEY,
        JSON.stringify({ ...current, ...patch }),
      );
    });

    await pendingAgeGateWrite;
  },
};

// Sticky chat preferences/session. We remember the conversation the user had
// open and the brainrot dial they last picked, so reopening the app drops them
// back where they were instead of a blank chat. Server-side data (the messages
// themselves) still lives in Firestore — this only persists which session to
// re-open and the local rot-level preference.
export interface PersistedChatSession {
  conversationId: string | null;
  rotLevel: number;
  // Local-only answering preferences. The toggle state lives ONLY on the device
  // (never synced to a profile/cloud settings doc); it's sent per message in the
  // stream payload. Both default to true. See store/chat.ts and streamAgent.ts.
  respondWithEmojis: boolean;
  respondWithMedia: boolean;
  // "Big Brain" reply-model upgrade. Same device-local, per-message lifecycle as
  // the prefs above, but defaults to FALSE (off) — it's an opt-in that spends
  // credits faster. See store/chat.ts and streamAgent.ts.
  bigBrain: boolean;
}

const CHAT_SESSION_KEY = "app.chatSession";

export const MIN_ROT_LEVEL = 1;
export const MAX_ROT_LEVEL = 3;
export const DEFAULT_ROT_LEVEL = 2;

export const DEFAULT_CHAT_SESSION: PersistedChatSession = {
  conversationId: null,
  rotLevel: DEFAULT_ROT_LEVEL,
  respondWithEmojis: true,
  respondWithMedia: true,
  bigBrain: false,
};

function clampRotLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ROT_LEVEL;
  }
  return Math.min(Math.max(Math.round(value), MIN_ROT_LEVEL), MAX_ROT_LEVEL);
}

function normalizeChatSession(value: unknown): PersistedChatSession {
  if (!isRecord(value)) return DEFAULT_CHAT_SESSION;

  return {
    conversationId:
      typeof value.conversationId === "string" && value.conversationId.length > 0
        ? value.conversationId
        : null,
    rotLevel: clampRotLevel(value.rotLevel),
    // Default ON: a missing field (older install) or any non-boolean reads as
    // true, matching the backend's default.
    respondWithEmojis: value.respondWithEmojis !== false,
    respondWithMedia: value.respondWithMedia !== false,
    // Default OFF: only an explicit `true` enables it, so older installs (field
    // absent) and the common case stay off, matching the backend's default.
    bigBrain: value.bigBrain === true,
  };
}

let pendingChatSessionWrite = Promise.resolve();

export const ChatSessionStorage = {
  async read(): Promise<PersistedChatSession> {
    try {
      const raw = await AsyncStorage.getItem(CHAT_SESSION_KEY);
      if (!raw) return DEFAULT_CHAT_SESSION;
      return normalizeChatSession(JSON.parse(raw));
    } catch {
      return DEFAULT_CHAT_SESSION;
    }
  },

  async write(patch: Partial<PersistedChatSession>): Promise<void> {
    pendingChatSessionWrite = pendingChatSessionWrite
      .then(async () => {
        const current = await ChatSessionStorage.read();
        await AsyncStorage.setItem(
          CHAT_SESSION_KEY,
          JSON.stringify({ ...current, ...patch }),
        );
      })
      .catch(() => {});

    await pendingChatSessionWrite;
  },

  async reset(): Promise<void> {
    pendingChatSessionWrite = pendingChatSessionWrite
      .then(() => AsyncStorage.removeItem(CHAT_SESSION_KEY))
      .catch(() => {});

    await pendingChatSessionWrite;
  },
};

// Work-in-progress persona drafts (persona creator). Stored LOCALLY only —
// never synced to the cloud — as a whole list (not a merged patch like the
// other stores), capped + normalized by the domain layer. The avatar inside a
// draft is a device-local image URI until publish, so nothing here is uploaded.
const PERSONA_DRAFTS_KEY = "app.personaDrafts";

let pendingPersonaDraftsWrite = Promise.resolve();

export const PersonaDraftsStorage = {
  async read(): Promise<PersonaDraft[]> {
    try {
      const raw = await AsyncStorage.getItem(PERSONA_DRAFTS_KEY);
      if (!raw) return [];
      return normalizeDrafts(JSON.parse(raw));
    } catch {
      return [];
    }
  },

  // Whole-list replace (the caller owns ordering/cap via the domain helpers);
  // re-normalized on the way out so a bad write can't corrupt the store.
  async write(drafts: PersonaDraft[]): Promise<void> {
    pendingPersonaDraftsWrite = pendingPersonaDraftsWrite
      .then(() =>
        AsyncStorage.setItem(
          PERSONA_DRAFTS_KEY,
          JSON.stringify(normalizeDrafts(drafts)),
        ),
      )
      .catch(() => {});

    await pendingPersonaDraftsWrite;
  },

  async reset(): Promise<void> {
    pendingPersonaDraftsWrite = pendingPersonaDraftsWrite
      .then(() => AsyncStorage.removeItem(PERSONA_DRAFTS_KEY))
      .catch(() => {});

    await pendingPersonaDraftsWrite;
  },
};

// AI avatar candidate pairs for SAVED personas, keyed by personaId. The persona
// creator keeps the last generated pair on the draft while a bot is still a draft
// (see PersonaDraftsStorage / PersonaDraft.generatedAvatars), but a published bot
// has no draft — editing it would otherwise lose the pair the moment the creator
// closes. This map is that pair's durable home for saved personas, so both
// candidates stay visible across close/reopen and saves, until the user
// regenerates (which replaces them). Stored LOCALLY only — the unpicked candidate
// is never moderated server-side, so it must not leave the device. The URIs point
// at cache JPEGs, so like drafts the record can outlive the files if the OS evicts
// them; the tile simply renders empty in that case.
const EDIT_AVATAR_CANDIDATES_KEY = "app.editAvatarCandidates";

type EditAvatarCandidates = Record<string, PickedAvatar[]>;

// Drops malformed entries and any persona whose pair normalizes to empty, so the
// map never accumulates dead keys.
function normalizeEditAvatarCandidates(value: unknown): EditAvatarCandidates {
  if (!isRecord(value)) return {};
  const out: EditAvatarCandidates = {};
  for (const [personaId, pair] of Object.entries(value)) {
    if (!personaId) continue;
    const candidates = normalizeGeneratedAvatars(pair);
    if (candidates.length > 0) out[personaId] = candidates;
  }
  return out;
}

let pendingEditAvatarCandidatesWrite = Promise.resolve();

export const EditAvatarCandidatesStorage = {
  async read(): Promise<EditAvatarCandidates> {
    try {
      const raw = await AsyncStorage.getItem(EDIT_AVATAR_CANDIDATES_KEY);
      if (!raw) return {};
      return normalizeEditAvatarCandidates(JSON.parse(raw));
    } catch {
      return {};
    }
  },

  // The stored pair for one persona, or [] when none (or unusable).
  async getFor(personaId: string): Promise<PickedAvatar[]> {
    const map = await EditAvatarCandidatesStorage.read();
    return map[personaId] ?? [];
  },

  // Replace one persona's pair. An empty list deletes its key, so regenerating to
  // nothing (or a cleared batch) never leaves a dangling entry. Serialized through
  // a write chain so concurrent updates from the in-flight generate compose.
  async setFor(personaId: string, candidates: PickedAvatar[]): Promise<void> {
    if (!personaId) return;
    pendingEditAvatarCandidatesWrite = pendingEditAvatarCandidatesWrite
      .then(async () => {
        const map = await EditAvatarCandidatesStorage.read();
        const normalized = normalizeGeneratedAvatars(candidates);
        if (normalized.length > 0) map[personaId] = normalized;
        else delete map[personaId];
        await AsyncStorage.setItem(
          EDIT_AVATAR_CANDIDATES_KEY,
          JSON.stringify(map),
        );
      })
      .catch(() => {});

    await pendingEditAvatarCandidatesWrite;
  },

  // Drop the pairs for deleted personas (wired into the persona-delete path).
  async removeFor(personaIds: string[]): Promise<void> {
    if (personaIds.length === 0) return;
    pendingEditAvatarCandidatesWrite = pendingEditAvatarCandidatesWrite
      .then(async () => {
        const map = await EditAvatarCandidatesStorage.read();
        let changed = false;
        for (const id of personaIds) {
          if (id in map) {
            delete map[id];
            changed = true;
          }
        }
        if (changed) {
          await AsyncStorage.setItem(
            EDIT_AVATAR_CANDIDATES_KEY,
            JSON.stringify(map),
          );
        }
      })
      .catch(() => {});

    await pendingEditAvatarCandidatesWrite;
  },

  async reset(): Promise<void> {
    pendingEditAvatarCandidatesWrite = pendingEditAvatarCandidatesWrite
      .then(() => AsyncStorage.removeItem(EDIT_AVATAR_CANDIDATES_KEY))
      .catch(() => {});

    await pendingEditAvatarCandidatesWrite;
  },
};

// AsyncStorage keys that must SURVIVE sign-out and account deletion. Today this
// is only the age gate — a device-level decision (see AGE_GATE_KEY) that must
// outlive deletion, otherwise an under-16 user could delete their account and
// re-pass the gate. Everything else under the `app.` namespace is user/session
// data and is wiped.
const PRESERVED_LOCAL_KEYS = new Set<string>([AGE_GATE_KEY]);

// Every `app.`-namespaced AsyncStorage key currently present that is NOT on the
// preserve list — i.e. residual user/session data. Used both as the wipe target
// and as the post-deletion validation surface (assertLocalDataCleared in
// store/auth.ts). Empty on a read error so a transient failure never reports a
// false "everything's clean".
export async function listResidualUserKeys(): Promise<string[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter(
      (key) => key.startsWith("app.") && !PRESERVED_LOCAL_KEYS.has(key),
    );
  } catch {
    return [];
  }
}

// One call clears every AsyncStorage key the app controls. Wired into the
// sign-out and account-deletion teardown AFTER the deletion callable succeeds,
// so a partial failure on the backend doesn't strand the user in a half-wiped
// local state.
//
// Two passes:
//   1. Reset the stores that own normalized, serialized writes so their pending
//      write chains drain first (a queued write must not re-land a key after the
//      sweep below removes it).
//   2. Backstop sweep: remove EVERY remaining `app.` key. This catches keys
//      owned by other modules (the persona selection, review-prompt, and daily-
//      paywall keys) and, critically, any key a future feature adds without
//      remembering to wire it in here — deletion stays complete by default.
//
// The age gate is preserved across both passes (see PRESERVED_LOCAL_KEYS).
export async function wipeLocalAppData(): Promise<void> {
  await Promise.all([
    SettingsStorage.reset(),
    OnboardingStorage.reset(),
    ChatSessionStorage.reset(),
    PersonaDraftsStorage.reset(),
    EditAvatarCandidatesStorage.reset(),
  ]);

  const residual = await listResidualUserKeys();
  if (residual.length > 0) {
    await AsyncStorage.multiRemove(residual).catch(() => {});
  }
}
