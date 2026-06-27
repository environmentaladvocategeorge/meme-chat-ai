import {
  canCreateDraft,
  createDraft,
  MAX_PERSONA_DRAFTS,
  normalizeDraft,
  normalizeDrafts,
  removeDraft,
  upsertDraft,
  type PersonaDraft,
} from "../personaDrafts";

function draftAt(id: string, updatedAt: number): PersonaDraft {
  return { ...createDraft(null), id, updatedAt };
}

describe("createDraft", () => {
  it("seeds from a template when given its id", () => {
    const d = createDraft("chaos_goblin");
    expect(d.templateId).toBe("chaos_goblin");
    expect(d.values.displayName).toBe("Chaos Goblin");
    expect(d.avatar).toBeNull();
    expect(d.step).toBe(0);
  });

  it("starts empty from scratch (no/unknown template)", () => {
    expect(createDraft(null).templateId).toBeNull();
    expect(createDraft("nope").values.displayName).toBe("");
    expect(createDraft(null).id).not.toBe(createDraft(null).id);
  });
});

describe("normalizeDraft / normalizeDrafts", () => {
  it("drops entries without an id", () => {
    expect(normalizeDraft({ updatedAt: 1 })).toBeNull();
    expect(normalizeDraft(undefined)).toBeNull();
  });

  it("coerces a partial draft and its avatar", () => {
    const d = normalizeDraft({
      id: "draft_1",
      values: { displayName: "X" },
      avatar: { localUri: "file://a.jpg", width: 100 },
      step: 2,
    });
    expect(d?.values.displayName).toBe("X");
    expect(d?.avatar).toEqual({ localUri: "file://a.jpg", width: 100 });
    expect(d?.step).toBe(2);
  });

  it("drops a malformed avatar (no localUri) to null", () => {
    expect(normalizeDraft({ id: "d", avatar: { width: 5 } })?.avatar).toBeNull();
  });

  it("orders most-recent first and enforces the cap", () => {
    const list = normalizeDrafts([
      draftAt("a", 100),
      draftAt("b", 300),
      draftAt("c", 200),
      draftAt("d", 400),
    ]);
    expect(list.map((d) => d.id)).toEqual(["d", "b", "c"]); // capped to 3, newest first
    expect(list).toHaveLength(MAX_PERSONA_DRAFTS);
  });

  it("returns [] for non-array input", () => {
    expect(normalizeDrafts(undefined)).toEqual([]);
  });
});

describe("canCreateDraft", () => {
  it("is false only at the cap", () => {
    expect(canCreateDraft([])).toBe(true);
    expect(canCreateDraft([draftAt("a", 1), draftAt("b", 2)])).toBe(true);
    expect(
      canCreateDraft([draftAt("a", 1), draftAt("b", 2), draftAt("c", 3)]),
    ).toBe(false);
  });
});

describe("upsertDraft", () => {
  it("replaces an existing draft by id and bumps it to front", () => {
    const a = draftAt("a", 100);
    const b = draftAt("b", 200);
    const updated = { ...a, values: { ...a.values, displayName: "New" } };
    const list = upsertDraft([b, a], updated);
    expect(list[0].id).toBe("a");
    expect(list[0].values.displayName).toBe("New");
    expect(list).toHaveLength(2);
  });

  it("prepends a new draft and enforces the cap (drops the oldest)", () => {
    const list = upsertDraft(
      [draftAt("a", 100), draftAt("b", 200), draftAt("c", 300)],
      draftAt("d", 0),
    );
    expect(list).toHaveLength(MAX_PERSONA_DRAFTS);
    expect(list.map((d) => d.id)).toContain("d");
    expect(list.map((d) => d.id)).not.toContain("a"); // oldest dropped
  });
});

describe("removeDraft", () => {
  it("removes by id", () => {
    expect(removeDraft([draftAt("a", 1), draftAt("b", 2)], "a").map((d) => d.id)).toEqual(["b"]);
  });
});
