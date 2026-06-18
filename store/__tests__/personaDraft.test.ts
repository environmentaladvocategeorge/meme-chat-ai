const storageData: { drafts: unknown[] } = { drafts: [] };
const writeMock = jest.fn(async (drafts: unknown[]) => {
  storageData.drafts = drafts;
});
const readMock = jest.fn(async () => storageData.drafts);

jest.mock("@/store/storage", () => ({
  PersonaDraftsStorage: {
    read: () => readMock(),
    write: (drafts: unknown[]) => writeMock(drafts),
    reset: jest.fn(),
  },
}));

import { createDraft, MAX_PERSONA_DRAFTS, type PersonaDraft } from "@/domain/personaDrafts";
import { usePersonaDraftStore } from "@/store/personaDraft";

const reset = () => {
  storageData.drafts = [];
  jest.clearAllMocks();
  usePersonaDraftStore.setState({
    drafts: [],
    savedIds: [],
    activeId: null,
    hydrated: false,
  });
};

describe("usePersonaDraftStore", () => {
  beforeEach(reset);

  it("hydrate loads persisted drafts", async () => {
    storageData.drafts = [createDraft("chaos_goblin")];
    await usePersonaDraftStore.getState().hydrate();
    expect(usePersonaDraftStore.getState().drafts).toHaveLength(1);
    expect(usePersonaDraftStore.getState().hydrated).toBe(true);
  });

  it("newDraft sets the active id in memory WITHOUT persisting (no autosave)", () => {
    const id = usePersonaDraftStore.getState().newDraft("deadpan_bestie");
    expect(id).not.toBeNull();
    expect(usePersonaDraftStore.getState().activeId).toBe(id);
    expect(usePersonaDraftStore.getState().drafts).toHaveLength(1);
    // Nothing hits disk until an explicit save.
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("newDraft returns null at the cap and adds nothing", () => {
    const full: PersonaDraft[] = Array.from({ length: MAX_PERSONA_DRAFTS }, (_, i) => ({
      ...createDraft(null),
      id: `d${i}`,
    }));
    usePersonaDraftStore.setState({ drafts: full });
    const id = usePersonaDraftStore.getState().newDraft("chaos_goblin");
    expect(id).toBeNull();
    expect(usePersonaDraftStore.getState().drafts).toHaveLength(MAX_PERSONA_DRAFTS);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("updateActive mutates memory only — still no write", () => {
    const id = usePersonaDraftStore.getState().newDraft(null);
    usePersonaDraftStore.getState().updateActive({
      values: { ...usePersonaDraftStore.getState().drafts[0].values, displayName: "Typed" },
    });
    expect(usePersonaDraftStore.getState().drafts.find((d) => d.id === id)?.values.displayName).toBe(
      "Typed",
    );
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("saveNow writes the current in-memory drafts to disk", async () => {
    usePersonaDraftStore.getState().newDraft(null);
    await usePersonaDraftStore.getState().saveNow();
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect((writeMock.mock.calls[0][0] as PersonaDraft[]).length).toBe(1);
  });

  it("a new working draft is NOT in savedIds until saved (the pill stays put)", async () => {
    const id = usePersonaDraftStore.getState().newDraft(null)!;
    // In `drafts` (so the creator renders it) but not yet "saved".
    expect(usePersonaDraftStore.getState().drafts).toHaveLength(1);
    expect(usePersonaDraftStore.getState().savedIds).not.toContain(id);
    await usePersonaDraftStore.getState().saveNow();
    expect(usePersonaDraftStore.getState().savedIds).toContain(id);
  });

  it("abandonActive reverts to disk and clears active (a never-saved draft vanishes)", async () => {
    usePersonaDraftStore.getState().newDraft(null);
    expect(usePersonaDraftStore.getState().drafts).toHaveLength(1);
    await usePersonaDraftStore.getState().abandonActive();
    // Disk was empty (never saved), so the working draft is gone.
    expect(usePersonaDraftStore.getState().drafts).toHaveLength(0);
    expect(usePersonaDraftStore.getState().activeId).toBeNull();
  });

  it("abandonActive keeps a previously-saved draft (only unsaved edits drop)", async () => {
    const id = usePersonaDraftStore.getState().newDraft(null)!;
    await usePersonaDraftStore.getState().saveNow(); // now on disk
    usePersonaDraftStore.getState().updateActive({
      values: { ...usePersonaDraftStore.getState().drafts[0].values, displayName: "Edited" },
    });
    await usePersonaDraftStore.getState().abandonActive();
    const draft = usePersonaDraftStore.getState().drafts.find((d) => d.id === id);
    expect(draft).toBeDefined();
    expect(draft?.values.displayName).not.toBe("Edited");
    expect(usePersonaDraftStore.getState().activeId).toBeNull();
  });

  it("discard removes the draft, persists, and clears active when it was active", () => {
    const id = usePersonaDraftStore.getState().newDraft(null)!;
    writeMock.mockClear();
    usePersonaDraftStore.getState().discard(id);
    expect(usePersonaDraftStore.getState().drafts).toHaveLength(0);
    expect(usePersonaDraftStore.getState().activeId).toBeNull();
    expect(writeMock).toHaveBeenCalledTimes(1);
  });
});
