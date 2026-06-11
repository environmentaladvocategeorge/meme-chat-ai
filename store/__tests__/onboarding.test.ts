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

import { useOnboardingStore } from "@/store/onboarding";
import { OnboardingStorage } from "@/store/storage";

// Settle the fire-and-forget OnboardingStorage.write the store methods issue.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  mockAsyncStorageData.clear();
  await useOnboardingStore.getState().reset();
});

describe("setCompleted", () => {
  it("marks completed with the justCompleted one-shot and persists", async () => {
    useOnboardingStore.getState().setCompleted(true);
    await flush();

    expect(useOnboardingStore.getState().completed).toBe(true);
    expect(useOnboardingStore.getState().justCompleted).toBe(true);
    await expect(OnboardingStorage.read()).resolves.toMatchObject({
      completed: true,
    });
  });
});

describe("markCompletedFromServer", () => {
  it("marks completed WITHOUT the justCompleted one-shot and persists", async () => {
    useOnboardingStore.getState().markCompletedFromServer();
    await flush();

    expect(useOnboardingStore.getState().completed).toBe(true);
    // The server restore must never re-seed the welcome chat.
    expect(useOnboardingStore.getState().justCompleted).toBe(false);
    await expect(OnboardingStorage.read()).resolves.toMatchObject({
      completed: true,
    });
  });

  it("no-ops when already completed (does not clear a pending one-shot)", async () => {
    useOnboardingStore.getState().setCompleted(true);
    useOnboardingStore.getState().markCompletedFromServer();
    await flush();

    expect(useOnboardingStore.getState().completed).toBe(true);
    expect(useOnboardingStore.getState().justCompleted).toBe(true);
  });
});

describe("reset", () => {
  it("clears the flag in memory and storage", async () => {
    useOnboardingStore.getState().markCompletedFromServer();
    await flush();
    await useOnboardingStore.getState().reset();

    expect(useOnboardingStore.getState().completed).toBe(false);
    await expect(OnboardingStorage.read()).resolves.toEqual({
      completed: false,
      step: 0,
    });
  });
});
