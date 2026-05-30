import { FieldValue } from "firebase-admin/firestore";
import {
  MAX_ALIAS_LENGTH,
  normalizeAlias,
  updateProfileForUser,
  type UpdateProfileArgs,
} from "../updateProfile";

describe("normalizeAlias", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeAlias("  Jorge  ")).toBe("Jorge");
  });

  it("collapses internal whitespace runs", () => {
    expect(normalizeAlias("group   chat   menace")).toBe("group chat menace");
  });

  it("maps empty / whitespace-only input to null", () => {
    expect(normalizeAlias("")).toBeNull();
    expect(normalizeAlias("    ")).toBeNull();
  });

  it("maps undefined to null", () => {
    expect(normalizeAlias(undefined)).toBeNull();
  });

  it("clamps to MAX_ALIAS_LENGTH characters", () => {
    const long = "a".repeat(MAX_ALIAS_LENGTH + 25);
    expect(normalizeAlias(long)).toHaveLength(MAX_ALIAS_LENGTH);
  });
});

// Minimal Firestore stand-in that captures the doc path + the merge patch the
// core writes, so we can assert behavior without a live Admin SDK.
function mockDb() {
  const set = jest.fn();
  const doc = jest.fn(() => ({ set }));
  return { db: { doc } as never, doc, set };
}

describe("updateProfileForUser", () => {
  it("writes the normalized alias to the user's profile with merge", async () => {
    const { db, doc, set } = mockDb();

    const result = await updateProfileForUser(
      "uid-1",
      { alias: "  Jorge  " } satisfies UpdateProfileArgs,
      db,
    );

    expect(doc).toHaveBeenCalledWith("profiles/uid-1");
    const [patch, options] = set.mock.calls[0];
    expect(patch.alias).toBe("Jorge");
    expect(patch.onboardingCompleted).toBe(true);
    expect(options).toEqual({ merge: true });
    expect(result.alias).toBe("Jorge");
    expect(result.onboardingCompleted).toBe(true);
  });

  it("clears the alias field when an empty alias is explicitly provided", async () => {
    const { db, set } = mockDb();

    const result = await updateProfileForUser("uid-1", { alias: "   " }, db);

    const [patch] = set.mock.calls[0];
    expect(patch.alias).toBe(FieldValue.delete());
    expect(result.alias).toBeNull();
  });

  it("leaves the alias untouched when the field is omitted (skip path)", async () => {
    const { db, set } = mockDb();

    const result = await updateProfileForUser("uid-1", {}, db);

    const [patch] = set.mock.calls[0];
    expect("alias" in patch).toBe(false);
    expect(patch.onboardingCompleted).toBe(true);
    expect(result.alias).toBeNull();
  });

  it("honors an explicit onboardingCompleted flag", async () => {
    const { db, set } = mockDb();

    await updateProfileForUser("uid-1", { onboardingCompleted: false }, db);

    const [patch] = set.mock.calls[0];
    expect(patch.onboardingCompleted).toBe(false);
  });
});
