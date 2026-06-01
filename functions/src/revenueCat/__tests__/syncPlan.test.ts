import { initialBilling } from "../../entitlement/schema";
import { syncRevenueCatPlanForUser } from "../syncPlan";

type DocRef = { path: string };

function makeDb(initial: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(initial));
  const sets: Array<{ path: string; data: unknown; options?: unknown }> = [];
  const db = {
    doc: (path: string): DocRef => ({ path }),
    runTransaction: async <T>(
      fn: (tx: {
        get: (ref: DocRef) => Promise<{ exists: boolean; data: () => unknown }>;
        set: (ref: DocRef, data: unknown, options?: unknown) => void;
      }) => Promise<T>,
    ) =>
      fn({
        get: async (ref) => ({
          exists: store.has(ref.path),
          data: () => store.get(ref.path),
        }),
        set: (ref, data, options) => {
          sets.push({ path: ref.path, data, options });
          store.set(ref.path, { ...(store.get(ref.path) as object), ...(data as object) });
        },
      }),
  };
  return { db, store, sets };
}

describe("syncRevenueCatPlanForUser", () => {
  it("does not recreate a missing profile", async () => {
    const { db, sets, store } = makeDb();

    const result = await syncRevenueCatPlanForUser(db as never, "uid-deleted", "monthly");

    expect(result).toEqual({
      plan: "basic",
      outcome: {
        applied: false,
        fromPlan: null,
        reason: "missing-profile",
      },
    });
    expect(sets).toEqual([]);
    expect(store.has("profiles/uid-deleted")).toBe(false);
  });

  it("updates an existing profile optimistically", async () => {
    const { db, store } = makeDb({
      "profiles/uid-1": initialBilling(new Date(1_700_000_000_000)),
    });

    const result = await syncRevenueCatPlanForUser(db as never, "uid-1", "monthly_2");

    expect(result).toMatchObject({
      plan: "plus",
      outcome: { applied: true, fromPlan: "free" },
    });
    expect(store.get("profiles/uid-1")).toMatchObject({
      plan: "plus",
      planSource: "revenuecat",
      rcAppUserId: "uid-1",
      rcActiveProductId: "monthly_2",
    });
  });
});
