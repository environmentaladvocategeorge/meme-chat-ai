import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

const STORAGE_KEY = "app.reviewPrompt";
const REVIEW_THRESHOLD = 7;
const LATER_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

type Persisted = {
  messageCount: number;
  // true once the prompt has been shown and either declined or accepted (done forever)
  // false while still eligible or in a "later" cooldown window
  done: boolean;
  nextEligibleAt: string | null;
};

type ReviewPromptState = Persisted & {
  // Set to true by recordMessageSent when threshold is crossed and user is eligible
  pending: boolean;
  hydrate: () => Promise<void>;
  recordMessageSent: () => Promise<void>;
  markAccepted: () => Promise<void>;
  markLater: () => Promise<void>;
  markDeclined: () => Promise<void>;
  // Sign-out / account-deletion teardown: back to defaults in memory and on
  // disk, so the next user on this device starts the review cadence fresh.
  reset: () => Promise<void>;
};

const DEFAULTS: Persisted = {
  messageCount: 0,
  done: false,
  nextEligibleAt: null,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalize(v: unknown): Persisted {
  if (!isRecord(v)) return DEFAULTS;
  return {
    messageCount:
      typeof v.messageCount === "number" && Number.isFinite(v.messageCount)
        ? Math.max(0, v.messageCount)
        : DEFAULTS.messageCount,
    done: typeof v.done === "boolean" ? v.done : DEFAULTS.done,
    nextEligibleAt:
      typeof v.nextEligibleAt === "string" ? v.nextEligibleAt : null,
  };
}

async function read(): Promise<Persisted> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

async function write(value: Persisted): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function isEligible(state: Persisted, newCount: number): boolean {
  if (state.done) return false;
  if (newCount < REVIEW_THRESHOLD) return false;
  if (state.nextEligibleAt) {
    const eligible = new Date(state.nextEligibleAt).getTime();
    if (!Number.isNaN(eligible) && Date.now() < eligible) return false;
  }
  return true;
}

export const useReviewPromptStore = create<ReviewPromptState>()((set, get) => ({
  ...DEFAULTS,
  pending: false,

  hydrate: async () => {
    const stored = await read();
    set({ ...stored, pending: false });
  },

  recordMessageSent: async () => {
    const current = get();
    if (current.done) return;

    const newCount = current.messageCount + 1;
    const shouldPrompt = isEligible(current, newCount);

    set({ messageCount: newCount, pending: shouldPrompt || current.pending });
    await write({ messageCount: newCount, done: current.done, nextEligibleAt: current.nextEligibleAt });
  },

  markAccepted: async () => {
    const next: Persisted = { messageCount: get().messageCount, done: true, nextEligibleAt: null };
    set({ ...next, pending: false });
    await write(next);
  },

  markDeclined: async () => {
    const next: Persisted = { messageCount: get().messageCount, done: true, nextEligibleAt: null };
    set({ ...next, pending: false });
    await write(next);
  },

  markLater: async () => {
    const nextEligibleAt = new Date(Date.now() + LATER_COOLDOWN_MS).toISOString();
    const next: Persisted = { messageCount: get().messageCount, done: false, nextEligibleAt };
    set({ ...next, pending: false });
    await write(next);
  },

  reset: async () => {
    set({ ...DEFAULTS, pending: false });
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // Best-effort — the backstop sweep in wipeLocalAppData also removes this
      // key, so a failure here doesn't leave it behind.
    }
  },
}));
