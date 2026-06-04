// Mock the Firebase / native-SDK-dragging deps so store/entitlement.ts imports
// cleanly under the node test env (mirrors store/__tests__/chat.test.ts). The
// real module pulls in firebase/firestore and the RC subscription store, neither
// of which loads outside a device.
const mockUnsubscribe = jest.fn();
// The latest snapshot callback handed to subscribeToEntitlement, so a test can
// simulate the profiles/{uid} snapshot landing.
let lastEntitlementCb: ((entitlement: unknown) => void) | null = null;
const mockSubscribe = jest.fn(
  (_uid: string, cb: (entitlement: unknown) => void) => {
    lastEntitlementCb = cb;
    return mockUnsubscribe;
  },
);

jest.mock("@/services/firebase/entitlement", () => ({
  subscribeToEntitlement: (uid: string, cb: (entitlement: unknown) => void) =>
    mockSubscribe(uid, cb),
}));
// Imported by entitlement.ts but unused by the logic under test here.
jest.mock("@/store/subscription", () => ({
  useSubscriptionStore: { getState: () => ({ plan: "free", status: "idle" }) },
}));

import type { PlanId } from "@/domain/billing";
import type { Entitlement } from "@/services/firebase/entitlement";
import {
  adsAllowed,
  pickEffectivePlan,
  useEntitlementStore,
} from "@/store/entitlement";

function entitlement(plan: PlanId = "basic"): Entitlement {
  return {
    plan,
    planSource: "revenuecat",
    creditsRemaining: 100,
    monthlyCredits: 1000,
    creditsResetAt: null,
    dailyCreditsUsed: 0,
    softDailyCredits: 50,
    dailyResetAt: null,
  };
}

describe("pickEffectivePlan", () => {
  it("returns the higher-rank tier when the subscription leads", () => {
    // RC reports an active paid sub before the backend mirror catches up.
    expect(pickEffectivePlan("plus", "free")).toBe("plus");
  });

  it("returns the higher-rank tier when the entitlement mirror leads", () => {
    // The backend already mirrored the upgrade; RC is briefly behind.
    expect(pickEffectivePlan("free", "power")).toBe("power");
  });

  it("keeps the shared plan when both sources agree", () => {
    expect(pickEffectivePlan("free", "free")).toBe("free");
    expect(pickEffectivePlan("basic", "basic")).toBe("basic");
  });

  it("never downgrades a paid user to the other source's lower tier", () => {
    // Whichever source knows about the paid tier wins, in both orderings.
    expect(pickEffectivePlan("power", "basic")).toBe("power");
    expect(pickEffectivePlan("basic", "power")).toBe("power");
  });
});

describe("adsAllowed", () => {
  it("allows ads only once both sources resolve AND agree the user is free", () => {
    expect(
      adsAllowed({
        entitlementLoaded: true,
        subscriptionResolved: true,
        effectivePlan: "free",
      }),
    ).toBe(true);
  });

  it("blocks ads during the entitlement load window (the flash regression)", () => {
    // The fix: before the first snapshot lands, the derived plan defaults to
    // "free" — but a paying user is indistinguishable from a real free user, so
    // ads must NOT render until `loaded` is true. This is the exact case the
    // pre-fix code got wrong.
    expect(
      adsAllowed({
        entitlementLoaded: false,
        subscriptionResolved: true,
        effectivePlan: "free",
      }),
    ).toBe(false);
  });

  it("blocks ads until the subscription store leaves idle", () => {
    expect(
      adsAllowed({
        entitlementLoaded: true,
        subscriptionResolved: false,
        effectivePlan: "free",
      }),
    ).toBe(false);
  });

  it("never shows ads to a paid user, even with everything resolved", () => {
    for (const plan of ["basic", "plus", "power"] as const) {
      expect(
        adsAllowed({
          entitlementLoaded: true,
          subscriptionResolved: true,
          effectivePlan: plan,
        }),
      ).toBe(false);
    }
  });
});

describe("useEntitlementStore loaded state machine", () => {
  beforeEach(() => {
    lastEntitlementCb = null;
    // Reset to the store's documented initial state before each case.
    useEntitlementStore.setState({ entitlement: null, loaded: false, uid: null });
  });

  it("binding a uid enters the loading state and subscribes", () => {
    useEntitlementStore.getState().bindUid("user-1");

    const state = useEntitlementStore.getState();
    expect(state.uid).toBe("user-1");
    expect(state.entitlement).toBeNull();
    // Still loading until the first snapshot arrives.
    expect(state.loaded).toBe(false);
    expect(mockSubscribe).toHaveBeenCalledWith("user-1", expect.any(Function));
  });

  it("marks loaded once the first snapshot lands and stores the entitlement", () => {
    useEntitlementStore.getState().bindUid("user-1");
    expect(useEntitlementStore.getState().loaded).toBe(false);

    // Simulate the profiles/{uid} snapshot arriving.
    lastEntitlementCb?.(entitlement("plus"));

    const state = useEntitlementStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.entitlement?.plan).toBe("plus");
  });

  it("resolves immediately as loaded on sign-out (uid null — nothing to load)", () => {
    // Arrive at a signed-in, loaded state first.
    useEntitlementStore.getState().bindUid("user-1");
    lastEntitlementCb?.(entitlement("basic"));

    useEntitlementStore.getState().bindUid(null);

    const state = useEntitlementStore.getState();
    expect(state.uid).toBeNull();
    expect(state.entitlement).toBeNull();
    // No listener to wait on, so it's resolved right away.
    expect(state.loaded).toBe(true);
  });

  it("is a no-op when binding the already-bound uid (no resubscribe)", () => {
    useEntitlementStore.getState().bindUid("user-1");
    mockSubscribe.mockClear();

    useEntitlementStore.getState().bindUid("user-1");

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("switching identity tears down the old listener and re-enters loading", () => {
    useEntitlementStore.getState().bindUid("user-1");
    lastEntitlementCb?.(entitlement("power"));
    expect(useEntitlementStore.getState().loaded).toBe(true);

    useEntitlementStore.getState().bindUid("user-2");

    const state = useEntitlementStore.getState();
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(state.uid).toBe("user-2");
    // Back to loading for the new identity — the old plan must not leak through.
    expect(state.loaded).toBe(false);
    expect(state.entitlement).toBeNull();
    expect(mockSubscribe).toHaveBeenLastCalledWith("user-2", expect.any(Function));
  });

  it("rebind re-attaches the listener for the current uid and resolves on snapshot", () => {
    useEntitlementStore.getState().bindUid("user-1");
    mockSubscribe.mockClear();

    useEntitlementStore.getState().rebind();
    expect(mockSubscribe).toHaveBeenCalledWith("user-1", expect.any(Function));

    lastEntitlementCb?.(entitlement("basic"));
    expect(useEntitlementStore.getState().loaded).toBe(true);
  });

  it("rebind is a no-op when no uid is bound", () => {
    useEntitlementStore.getState().rebind();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});
