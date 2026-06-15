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
  PersonaDraftsStorage,
  SettingsStorage,
  wipeLocalAppData,
} from "@/store/storage";
import { createDraft, MAX_PERSONA_DRAFTS } from "@/domain/personaDrafts";

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
    await PersonaDraftsStorage.write([createDraft("chaos_goblin")]);
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
    await expect(PersonaDraftsStorage.read()).resolves.toEqual([]);
    await expect(AgeGateStorage.read()).resolves.toEqual({
      status: "passed",
      birthDate: "1990-01-01",
    });
  });
});

describe("PersonaDraftsStorage", () => {
  beforeEach(() => {
    mockAsyncStorageData.clear();
    jest.clearAllMocks();
  });

  it("returns [] when nothing is stored", async () => {
    await expect(PersonaDraftsStorage.read()).resolves.toEqual([]);
  });

  it("round-trips a draft list", async () => {
    const draft = createDraft("deadpan_bestie");
    await PersonaDraftsStorage.write([draft]);
    const read = await PersonaDraftsStorage.read();
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe(draft.id);
    expect(read[0].values.displayName).toBe("Deadpan Bestie");
  });

  it("normalizes on write: caps the list and orders most-recent first", async () => {
    const many = Array.from({ length: MAX_PERSONA_DRAFTS + 2 }, (_, i) => ({
      ...createDraft(null),
      id: `d${i}`,
      updatedAt: i, // ascending, so the highest i is newest
    }));
    await PersonaDraftsStorage.write(many);
    const read = await PersonaDraftsStorage.read();
    expect(read).toHaveLength(MAX_PERSONA_DRAFTS);
    expect(read[0].id).toBe(`d${MAX_PERSONA_DRAFTS + 1}`); // newest first
  });

  it("reset clears the list", async () => {
    await PersonaDraftsStorage.write([createDraft(null)]);
    await PersonaDraftsStorage.reset();
    await expect(PersonaDraftsStorage.read()).resolves.toEqual([]);
  });
});
