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

import { useReviewPromptStore } from "@/store/reviewPrompt";

const STORAGE_KEY = "app.reviewPrompt";

describe("useReviewPromptStore.reset", () => {
  beforeEach(() => {
    mockAsyncStorageData.clear();
    jest.clearAllMocks();
    useReviewPromptStore.setState({
      messageCount: 0,
      done: false,
      nextEligibleAt: null,
      pending: false,
    });
  });

  it("clears persisted state and resets the store on account deletion", async () => {
    // Simulate a user who has been declined-out (done forever) with history.
    await useReviewPromptStore.getState().markDeclined();
    expect(mockAsyncStorageData.has(STORAGE_KEY)).toBe(true);

    await useReviewPromptStore.getState().reset();

    expect(mockAsyncStorageData.has(STORAGE_KEY)).toBe(false);
    const state = useReviewPromptStore.getState();
    expect(state.messageCount).toBe(0);
    expect(state.done).toBe(false);
    expect(state.nextEligibleAt).toBeNull();
    expect(state.pending).toBe(false);
  });
});
