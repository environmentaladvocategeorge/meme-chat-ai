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
  AgeGateStorage,
  ChatSessionStorage,
  DEFAULT_CHAT_SESSION,
  DEFAULT_SETTINGS,
  OnboardingStorage,
  SettingsStorage,
  wipeLocalAppData,
} from "@/store/storage";

describe("wipeLocalAppData", () => {
  beforeEach(() => {
    mockAsyncStorageData.clear();
    jest.clearAllMocks();
  });

  it("clears app-owned local state but preserves the device age gate", async () => {
    await SettingsStorage.write({
      appearance: "dark",
      language: "es",
      alias: "tester",
      chatBubbleStyle: DEFAULT_SETTINGS.chatBubbleStyle,
      chatBackground: DEFAULT_SETTINGS.chatBackground,
    });
    await OnboardingStorage.write({ completed: true, step: 3 });
    await ChatSessionStorage.write({ conversationId: "c1", rotLevel: 3 });
    await AgeGateStorage.write({
      status: "passed",
      birthDate: "1990-01-01",
    });

    await wipeLocalAppData();

    await expect(SettingsStorage.read()).resolves.toEqual(DEFAULT_SETTINGS);
    await expect(OnboardingStorage.read()).resolves.toEqual({
      completed: false,
      step: 0,
    });
    await expect(ChatSessionStorage.read()).resolves.toEqual(DEFAULT_CHAT_SESSION);
    await expect(AgeGateStorage.read()).resolves.toEqual({
      status: "passed",
      birthDate: "1990-01-01",
    });
  });
});
