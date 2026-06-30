import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

const STORAGE_KEY = "app.adGate";

// Free users see an interstitial ad once every this-many completed replies. The
// count advances on each successfully streamed reply (see chat store) and the
// ad is shown by useInterstitialAdGate the moment the reply settles.
export const AD_INTERVAL = 10;

// New-bot cadence: the first interstitial fires after this many "create a bot"
// taps, then one every NEW_BOT_AD_INTERVAL taps thereafter (3, 8, 13, ...). The
// first window is shorter so a brand-new free user meets the ad early; the wider
// window after keeps it from nagging.
export const NEW_BOT_FIRST_AD = 3;
export const NEW_BOT_AD_INTERVAL = 5;

type Persisted = {
  // Completed replies since the last reply-triggered ad. Resets to 0 each time
  // the interval is crossed. Persisted so the cadence survives an app restart
  // instead of re-arming a free user with a fresh grace period every launch.
  repliesSinceAd: number;
  // "Create a bot" taps since the last bot-triggered ad. Resets to 0 each time a
  // bot ad fires.
  newBotClicks: number;
  // Whether the first (after NEW_BOT_FIRST_AD) bot ad has fired yet. Switches the
  // bot cadence from the short first window to the wider repeat window.
  firstBotAdShown: boolean;
};

type AdGateState = Persisted & {
  // Flipped true when either cadence crosses its threshold.
  // useInterstitialAdGate watches this, shows the ad for confirmed-free users,
  // then clears it. Never persisted — a pending ad that the app dies before
  // showing is simply forgotten (the next interval comes around soon enough).
  pending: boolean;
  hydrate: () => Promise<void>;
  // Advance the reply cadence (call once per successfully streamed reply).
  recordReplyCompleted: () => Promise<void>;
  // Advance the new-bot cadence (call once per "create a bot" tap that actually
  // opens the creator — not the at-cap paywall bounce).
  recordNewBotClick: () => Promise<void>;
  clearPending: () => void;
  // Sign-out / account-deletion teardown: back to defaults in memory and on
  // disk, so the next user on this device starts the ad cadence fresh.
  reset: () => Promise<void>;
};

const DEFAULTS: Persisted = {
  repliesSinceAd: 0,
  newBotClicks: 0,
  firstBotAdShown: false,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function toCount(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.floor(v))
    : fallback;
}

function normalize(v: unknown): Persisted {
  if (!isRecord(v)) return DEFAULTS;
  return {
    repliesSinceAd: toCount(v.repliesSinceAd, DEFAULTS.repliesSinceAd),
    newBotClicks: toCount(v.newBotClicks, DEFAULTS.newBotClicks),
    firstBotAdShown:
      typeof v.firstBotAdShown === "boolean"
        ? v.firstBotAdShown
        : DEFAULTS.firstBotAdShown,
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

function persistedOf(state: Persisted): Persisted {
  return {
    repliesSinceAd: state.repliesSinceAd,
    newBotClicks: state.newBotClicks,
    firstBotAdShown: state.firstBotAdShown,
  };
}

async function write(value: Persisted): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export const useAdGateStore = create<AdGateState>()((set, get) => ({
  ...DEFAULTS,
  pending: false,

  hydrate: async () => {
    const stored = await read();
    set({ ...stored, pending: false });
  },

  recordReplyCompleted: async () => {
    const next = get().repliesSinceAd + 1;
    if (next >= AD_INTERVAL) {
      // Threshold reached — queue the ad and rearm the counter. pending stays
      // set even if the user turns out to be paid; the gate clears it without
      // showing anything (see useInterstitialAdGate).
      set({ repliesSinceAd: 0, pending: true });
    } else {
      set({ repliesSinceAd: next });
    }
    await write(persistedOf(get()));
  },

  recordNewBotClick: async () => {
    const { newBotClicks, firstBotAdShown } = get();
    const threshold = firstBotAdShown ? NEW_BOT_AD_INTERVAL : NEW_BOT_FIRST_AD;
    const next = newBotClicks + 1;
    if (next >= threshold) {
      set({ newBotClicks: 0, firstBotAdShown: true, pending: true });
    } else {
      set({ newBotClicks: next });
    }
    await write(persistedOf(get()));
  },

  clearPending: () => set({ pending: false }),

  reset: async () => {
    set({ ...DEFAULTS, pending: false });
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // Best-effort — the backstop sweep in wipeLocalAppData also removes every
      // `app.` key, so a failure here doesn't leave it behind.
    }
  },
}));
