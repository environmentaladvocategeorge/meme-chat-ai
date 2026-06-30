const mockAsyncStorageData = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) =>
      Promise.resolve(mockAsyncStorageData.get(key) ?? null),
    ),
    setItem: jest.fn((key: string, value: string) => {
      mockAsyncStorageData.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      mockAsyncStorageData.delete(key);
      return Promise.resolve();
    }),
  },
}));

import {
  AD_INTERVAL,
  NEW_BOT_AD_INTERVAL,
  NEW_BOT_FIRST_AD,
  useAdGateStore,
} from "@/store/adGate";

const STORAGE_KEY = "app.adGate";

type Persisted = {
  repliesSinceAd: number;
  newBotClicks: number;
  firstBotAdShown: boolean;
};

function persisted(): Persisted | null {
  const raw = mockAsyncStorageData.get(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function recordReplies(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await useAdGateStore.getState().recordReplyCompleted();
  }
}

async function recordBotClicks(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await useAdGateStore.getState().recordNewBotClick();
  }
}

describe("useAdGateStore", () => {
  beforeEach(() => {
    mockAsyncStorageData.clear();
    jest.clearAllMocks();
    useAdGateStore.setState({
      repliesSinceAd: 0,
      newBotClicks: 0,
      firstBotAdShown: false,
      pending: false,
    });
  });

  describe("reply cadence", () => {
    it("does not arm the ad before the interval is reached", async () => {
      await recordReplies(AD_INTERVAL - 1);

      const state = useAdGateStore.getState();
      expect(state.pending).toBe(false);
      expect(state.repliesSinceAd).toBe(AD_INTERVAL - 1);
      expect(persisted()?.repliesSinceAd).toBe(AD_INTERVAL - 1);
    });

    it("arms the ad and rearms the counter when the interval is crossed", async () => {
      await recordReplies(AD_INTERVAL);

      const state = useAdGateStore.getState();
      expect(state.pending).toBe(true);
      expect(state.repliesSinceAd).toBe(0);
      expect(persisted()?.repliesSinceAd).toBe(0);
    });

    it("arms again on the next full interval", async () => {
      await recordReplies(AD_INTERVAL);
      useAdGateStore.getState().clearPending();

      await recordReplies(AD_INTERVAL - 1);
      expect(useAdGateStore.getState().pending).toBe(false);

      await recordReplies(1);
      expect(useAdGateStore.getState().pending).toBe(true);
    });
  });

  describe("new-bot cadence", () => {
    it("does not arm before the first threshold", async () => {
      await recordBotClicks(NEW_BOT_FIRST_AD - 1);

      const state = useAdGateStore.getState();
      expect(state.pending).toBe(false);
      expect(state.newBotClicks).toBe(NEW_BOT_FIRST_AD - 1);
      expect(state.firstBotAdShown).toBe(false);
    });

    it("arms the first ad after NEW_BOT_FIRST_AD taps", async () => {
      await recordBotClicks(NEW_BOT_FIRST_AD);

      const state = useAdGateStore.getState();
      expect(state.pending).toBe(true);
      expect(state.newBotClicks).toBe(0);
      expect(state.firstBotAdShown).toBe(true);
    });

    it("uses the wider interval after the first ad (3, then every 5)", async () => {
      // First ad at tap #3.
      await recordBotClicks(NEW_BOT_FIRST_AD);
      useAdGateStore.getState().clearPending();

      // Next ad only after NEW_BOT_AD_INTERVAL more taps, not NEW_BOT_FIRST_AD.
      await recordBotClicks(NEW_BOT_AD_INTERVAL - 1);
      expect(useAdGateStore.getState().pending).toBe(false);

      await recordBotClicks(1);
      expect(useAdGateStore.getState().pending).toBe(true);
      expect(useAdGateStore.getState().firstBotAdShown).toBe(true);
    });
  });

  it("the two cadences advance independently", async () => {
    await recordReplies(AD_INTERVAL - 1);
    await recordBotClicks(NEW_BOT_FIRST_AD);

    // Bot cadence armed the ad; the reply counter is untouched.
    const state = useAdGateStore.getState();
    expect(state.pending).toBe(true);
    expect(state.repliesSinceAd).toBe(AD_INTERVAL - 1);
  });

  it("clearPending lowers the flag without touching the counters", async () => {
    await recordReplies(AD_INTERVAL + 2);
    await recordBotClicks(1);
    expect(useAdGateStore.getState().pending).toBe(true);

    useAdGateStore.getState().clearPending();

    expect(useAdGateStore.getState().pending).toBe(false);
    expect(useAdGateStore.getState().repliesSinceAd).toBe(2);
    expect(useAdGateStore.getState().newBotClicks).toBe(1);
  });

  it("hydrate restores persisted counters and never resumes pending", async () => {
    mockAsyncStorageData.set(
      STORAGE_KEY,
      JSON.stringify({
        repliesSinceAd: AD_INTERVAL - 1,
        newBotClicks: 2,
        firstBotAdShown: true,
      }),
    );

    await useAdGateStore.getState().hydrate();

    const state = useAdGateStore.getState();
    expect(state.repliesSinceAd).toBe(AD_INTERVAL - 1);
    expect(state.newBotClicks).toBe(2);
    expect(state.firstBotAdShown).toBe(true);
    expect(state.pending).toBe(false);
  });

  it("ignores a corrupt persisted payload", async () => {
    mockAsyncStorageData.set(STORAGE_KEY, "{not json");

    await useAdGateStore.getState().hydrate();

    expect(useAdGateStore.getState().repliesSinceAd).toBe(0);
    expect(useAdGateStore.getState().newBotClicks).toBe(0);
  });

  it("reset clears persisted state and the store on teardown", async () => {
    await recordReplies(AD_INTERVAL + 1);
    await recordBotClicks(2);
    expect(mockAsyncStorageData.has(STORAGE_KEY)).toBe(true);

    await useAdGateStore.getState().reset();

    expect(mockAsyncStorageData.has(STORAGE_KEY)).toBe(false);
    const state = useAdGateStore.getState();
    expect(state.repliesSinceAd).toBe(0);
    expect(state.newBotClicks).toBe(0);
    expect(state.firstBotAdShown).toBe(false);
    expect(state.pending).toBe(false);
  });
});
