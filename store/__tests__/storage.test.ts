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
    getAllKeys: jest.fn(() => Promise.resolve([...mockAsyncStorageData.keys()])),
    multiRemove: jest.fn((keys: string[]) => {
      for (const key of keys) mockAsyncStorageData.delete(key);
      return Promise.resolve();
    }),
  },
}));

import {
  AgeGateStorage,
  ChatSessionStorage,
  DEFAULT_CHAT_SESSION,
  DEFAULT_SETTINGS,
  EditAvatarCandidatesStorage,
  listResidualUserKeys,
  OnboardingStorage,
  PersonaDraftsStorage,
  SettingsStorage,
  wipeLocalAppData,
} from "@/store/storage";
import { createDraft, MAX_PERSONA_DRAFTS } from "@/domain/personaDrafts";

// A candidate avatar matching what the generator hands the creator.
const candidate = (uri: string) => ({ localUri: uri, width: 512, height: 512 });

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
    await EditAvatarCandidatesStorage.setFor("persona-1", [candidate("file:///a.jpg")]);
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
    await expect(EditAvatarCandidatesStorage.read()).resolves.toEqual({});
    await expect(AgeGateStorage.read()).resolves.toEqual({
      status: "passed",
      birthDate: "1990-01-01",
    });
  });

  it("sweeps app.* keys owned by other modules but keeps the age gate", async () => {
    // Keys NOT reset by any explicit store reset in wipeLocalAppData — they must
    // still be removed by the backstop getAllKeys sweep.
    mockAsyncStorageData.set("app.persona.selectedId", "user_persona_42");
    mockAsyncStorageData.set("app.reviewPrompt", JSON.stringify({ done: true }));
    mockAsyncStorageData.set("app.dailyPaywallShownDate", "2026-06-18");
    // A future key nobody remembered to wire in is still caught by the sweep.
    mockAsyncStorageData.set("app.somethingNew", "x");
    await AgeGateStorage.write({ status: "passed", birthDate: "1990-01-01" });

    await wipeLocalAppData();

    expect(mockAsyncStorageData.has("app.persona.selectedId")).toBe(false);
    expect(mockAsyncStorageData.has("app.reviewPrompt")).toBe(false);
    expect(mockAsyncStorageData.has("app.dailyPaywallShownDate")).toBe(false);
    expect(mockAsyncStorageData.has("app.somethingNew")).toBe(false);
    // The device age gate is the one deliberate survivor.
    expect(mockAsyncStorageData.has("app.ageGate")).toBe(true);
  });
});

describe("listResidualUserKeys", () => {
  beforeEach(() => {
    mockAsyncStorageData.clear();
    jest.clearAllMocks();
  });

  it("reports app.* keys except the preserved age gate", async () => {
    mockAsyncStorageData.set("app.persona.selectedId", "p1");
    mockAsyncStorageData.set("app.reviewPrompt", "{}");
    mockAsyncStorageData.set("app.ageGate", "{}");
    // A non-app key (e.g. a library's) is never our concern.
    mockAsyncStorageData.set("firebase:authUser", "{}");

    const residual = await listResidualUserKeys();

    expect(residual.sort()).toEqual([
      "app.persona.selectedId",
      "app.reviewPrompt",
    ]);
  });

  it("is empty once everything has been wiped", async () => {
    await AgeGateStorage.write({ status: "passed", birthDate: "1990-01-01" });
    await SettingsStorage.write({ alias: "x" });

    await wipeLocalAppData();

    await expect(listResidualUserKeys()).resolves.toEqual([]);
  });
});

describe("EditAvatarCandidatesStorage", () => {
  beforeEach(() => {
    mockAsyncStorageData.clear();
    jest.clearAllMocks();
  });

  it("returns {} / [] when nothing is stored", async () => {
    await expect(EditAvatarCandidatesStorage.read()).resolves.toEqual({});
    await expect(EditAvatarCandidatesStorage.getFor("p1")).resolves.toEqual([]);
  });

  it("round-trips a persona's candidate pair", async () => {
    const pair = [candidate("file:///a.jpg"), candidate("file:///b.jpg")];
    await EditAvatarCandidatesStorage.setFor("p1", pair);
    await expect(EditAvatarCandidatesStorage.getFor("p1")).resolves.toEqual(pair);
  });

  it("keeps personas independent", async () => {
    await EditAvatarCandidatesStorage.setFor("p1", [candidate("file:///a.jpg")]);
    await EditAvatarCandidatesStorage.setFor("p2", [candidate("file:///b.jpg")]);
    await expect(EditAvatarCandidatesStorage.getFor("p1")).resolves.toEqual([
      candidate("file:///a.jpg"),
    ]);
    await expect(EditAvatarCandidatesStorage.getFor("p2")).resolves.toEqual([
      candidate("file:///b.jpg"),
    ]);
  });

  it("an empty pair deletes the key instead of storing []", async () => {
    await EditAvatarCandidatesStorage.setFor("p1", [candidate("file:///a.jpg")]);
    await EditAvatarCandidatesStorage.setFor("p1", []);
    await expect(EditAvatarCandidatesStorage.read()).resolves.toEqual({});
  });

  it("normalizes on write: drops URI-less entries and caps at two", async () => {
    await EditAvatarCandidatesStorage.setFor("p1", [
      candidate("file:///a.jpg"),
      { localUri: "", width: 1, height: 1 },
      candidate("file:///b.jpg"),
      candidate("file:///c.jpg"),
    ]);
    const stored = await EditAvatarCandidatesStorage.getFor("p1");
    expect(stored).toEqual([candidate("file:///a.jpg"), candidate("file:///b.jpg")]);
  });

  it("removeFor drops only the named personas", async () => {
    await EditAvatarCandidatesStorage.setFor("p1", [candidate("file:///a.jpg")]);
    await EditAvatarCandidatesStorage.setFor("p2", [candidate("file:///b.jpg")]);
    await EditAvatarCandidatesStorage.removeFor(["p1"]);
    await expect(EditAvatarCandidatesStorage.read()).resolves.toEqual({
      p2: [candidate("file:///b.jpg")],
    });
  });

  it("reset clears every persona's pair", async () => {
    await EditAvatarCandidatesStorage.setFor("p1", [candidate("file:///a.jpg")]);
    await EditAvatarCandidatesStorage.reset();
    await expect(EditAvatarCandidatesStorage.read()).resolves.toEqual({});
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
