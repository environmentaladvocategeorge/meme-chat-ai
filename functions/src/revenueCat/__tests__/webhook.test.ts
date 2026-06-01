import { Timestamp } from "firebase-admin/firestore";
import { PLANS } from "../../billing/plans";
import { initialBilling, MONTHLY_WINDOW_MS } from "../../entitlement/schema";
import { processRevenueCatEvent } from "../webhook";
import type { RcEvent } from "../types";

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
          store.set(ref.path, data);
        },
      }),
  };
  return { db, store, sets };
}

describe("processRevenueCatEvent", () => {
  it("does not recreate a deleted profile for a late webhook", async () => {
    const { db, sets, store } = makeDb();
    const event: RcEvent = {
      id: "evt-late",
      type: "INITIAL_PURCHASE",
      app_user_id: "uid-deleted",
      product_id: "monthly",
    };

    const outcome = await processRevenueCatEvent(db as never, event);

    expect(outcome).toEqual({
      duplicate: false,
      applied: false,
      reason: "missing-profile",
    });
    expect(store.has("profiles/uid-deleted")).toBe(false);
    expect(sets.map((set) => set.path)).toEqual(["revenueCatEvents/evt-late"]);
    expect(JSON.stringify(sets[0].data)).not.toContain("uid-deleted");
    expect(JSON.stringify(sets[0].data)).not.toContain("app_user_id");
  });

  it("updates an existing profile and keeps the audit echo de-identified", async () => {
    const now = new Date(1_700_000_000_000);
    const { db, sets, store } = makeDb({
      "profiles/uid-1": initialBilling(now),
    });
    const event: RcEvent = {
      id: "evt-apply",
      type: "INITIAL_PURCHASE",
      app_user_id: "uid-1",
      product_id: "monthly",
      expiration_at_ms: now.getTime() + MONTHLY_WINDOW_MS,
    };

    const outcome = await processRevenueCatEvent(db as never, event);

    expect(outcome).toMatchObject({
      duplicate: false,
      applied: true,
      plan: "basic",
    });
    expect(store.get("profiles/uid-1")).toMatchObject({
      plan: "basic",
      monthlyCredits: PLANS.basic.monthlyCredits,
      rcActiveProductId: "monthly",
      rcEntitlementExpiresAt: Timestamp.fromMillis(
        now.getTime() + MONTHLY_WINDOW_MS,
      ),
    });
    const audit = sets.find((set) => set.path === "revenueCatEvents/evt-apply");
    expect(JSON.stringify(audit?.data)).not.toContain("uid-1");
    expect(JSON.stringify(audit?.data)).not.toContain("app_user_id");
  });
});
