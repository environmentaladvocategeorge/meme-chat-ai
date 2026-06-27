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

const fetchUserPersonas = jest.fn();
jest.mock("@/services/firebase/personas", () => ({
  fetchUserPersonas: (uid: string) => fetchUserPersonas(uid),
}));

import { DEFAULT_PERSONA_ID, type UserPersonaSummary } from "@/domain/personas";
import { usePersonaStore } from "@/store/personas";

function summary(id: string): UserPersonaSummary {
  return {
    id,
    displayName: "Capy",
    avatarKey: "capybara",
    shortDescription: "Zen",
    toneTags: ["chill"],
  };
}

const reset = () => {
  mockAsyncStorageData.clear();
  jest.clearAllMocks();
  usePersonaStore.setState({
    selectedPersonaId: DEFAULT_PERSONA_ID,
    personas: [],
    status: "idle",
  });
};

describe("usePersonaStore", () => {
  beforeEach(reset);

  it("defaults the selection to Brainrot Bot", () => {
    expect(usePersonaStore.getState().selectedPersonaId).toBe(DEFAULT_PERSONA_ID);
  });

  it("select() updates and persists the chosen id", async () => {
    usePersonaStore.getState().select("user_uid-1_a1");
    expect(usePersonaStore.getState().selectedPersonaId).toBe("user_uid-1_a1");
    expect(mockAsyncStorageData.get("app.persona.selectedId")).toBe("user_uid-1_a1");
  });

  it("hydrateSelection() restores a previously persisted id", async () => {
    mockAsyncStorageData.set("app.persona.selectedId", "user_uid-1_b2");
    await usePersonaStore.getState().hydrateSelection();
    expect(usePersonaStore.getState().selectedPersonaId).toBe("user_uid-1_b2");
  });

  it("hydrate() loads the user's personas and marks ready", async () => {
    fetchUserPersonas.mockResolvedValueOnce([summary("user_uid-1_a1")]);
    await usePersonaStore.getState().hydrate("uid-1");
    expect(fetchUserPersonas).toHaveBeenCalledWith("uid-1");
    expect(usePersonaStore.getState().personas).toHaveLength(1);
    expect(usePersonaStore.getState().status).toBe("ready");
  });

  it("hydrate() marks error and keeps the list empty on failure", async () => {
    fetchUserPersonas.mockRejectedValueOnce(new Error("offline"));
    await usePersonaStore.getState().hydrate("uid-1");
    expect(usePersonaStore.getState().status).toBe("error");
    expect(usePersonaStore.getState().personas).toEqual([]);
  });

  it("removeMany() drops the given personas and leaves an unrelated selection intact", () => {
    usePersonaStore.getState().select("user_uid-1_a1");
    usePersonaStore.setState({
      personas: [summary("user_uid-1_a1"), summary("user_uid-1_b2"), summary("user_uid-1_c3")],
      status: "ready",
    });

    usePersonaStore.getState().removeMany(["user_uid-1_b2", "user_uid-1_c3"]);

    expect(usePersonaStore.getState().personas.map((p) => p.id)).toEqual([
      "user_uid-1_a1",
    ]);
    // The active selection wasn't deleted, so it stays put.
    expect(usePersonaStore.getState().selectedPersonaId).toBe("user_uid-1_a1");
  });

  it("removeMany() falls back to the default (and re-persists) when the active persona is deleted", () => {
    usePersonaStore.getState().select("user_uid-1_a1");
    usePersonaStore.setState({
      personas: [summary("user_uid-1_a1"), summary("user_uid-1_b2")],
      status: "ready",
    });

    usePersonaStore.getState().removeMany(["user_uid-1_a1"]);

    expect(usePersonaStore.getState().personas.map((p) => p.id)).toEqual([
      "user_uid-1_b2",
    ]);
    expect(usePersonaStore.getState().selectedPersonaId).toBe(DEFAULT_PERSONA_ID);
    expect(mockAsyncStorageData.get("app.persona.selectedId")).toBe(DEFAULT_PERSONA_ID);
  });

  it("clear() resets selection to default, empties the list, and forgets the persisted id", async () => {
    usePersonaStore.getState().select("user_uid-1_a1");
    usePersonaStore.setState({ personas: [summary("user_uid-1_a1")], status: "ready" });

    usePersonaStore.getState().clear();

    expect(usePersonaStore.getState().selectedPersonaId).toBe(DEFAULT_PERSONA_ID);
    expect(usePersonaStore.getState().personas).toEqual([]);
    expect(usePersonaStore.getState().status).toBe("idle");
    expect(mockAsyncStorageData.has("app.persona.selectedId")).toBe(false);
  });
});
