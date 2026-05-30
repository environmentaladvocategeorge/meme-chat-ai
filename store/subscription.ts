import { Linking, Platform } from "react-native";
import Purchases, {
  type CustomerInfo,
  type PurchasesEntitlementInfo,
} from "react-native-purchases";
import { create } from "zustand";
import {
  REVENUECAT_PRODUCT_TO_PLAN,
  isKnownRcProduct,
  resolvePlanFromRcProductIds,
  type PlanId,
} from "@/domain/billing";
import { syncRevenueCatPlanCallable } from "@/services/firebase/callables";

type SubscriptionMode = "test" | "production";
type SubscriptionStatus = "idle" | "ready" | "unavailable";

type SubscriptionState = {
  status: SubscriptionStatus;
  mode: SubscriptionMode | null;
  plan: PlanId;
  activeProductId: string | null;
  expiresAt: Date | null;
  entitlementId: string;
  // Apple/Google subscription-management URL surfaced via RC. Null until RC
  // is ready and the user has at least one purchase on file.
  managementUrl: string | null;
  // Derived legacy flag kept so existing call sites that read `isPro` keep
  // working; new code should branch on `plan` instead.
  isPro: boolean;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  setRcUser: (uid: string | null) => Promise<void>;
  // For users who already have an active subscription, plan changes must
  // go through Apple/Google's subscription management — calling
  // purchasePackage() directly leads to messy proration UX. This opens the
  // RC Customer Center if enabled, else the management URL, else the App
  // Store subscriptions page. Returns true if a sheet/page was opened.
  openManagement: () => Promise<boolean>;
};

const DEFAULT_ENTITLEMENT_ID = "pro";
const APP_STORE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";
const PLAY_STORE_SUBSCRIPTIONS_URL =
  "https://play.google.com/store/account/subscriptions";

let initializationPromise: Promise<void> | null = null;

function normalizeEnv(value: string | undefined) {
  if (!value) return "";
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("REPLACE_WITH_") ||
    trimmed.includes("YOUR_") ||
    trimmed.includes("PLACEHOLDER")
  ) {
    return "";
  }
  return trimmed;
}

function getEntitlementId() {
  return (
    normalizeEnv(process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID) ||
    DEFAULT_ENTITLEMENT_ID
  );
}

function getApiConfig(): { apiKey: string; mode: SubscriptionMode } | null {
  const testKey = normalizeEnv(process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY);
  const useTestStore =
    process.env.EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE?.trim().toLowerCase() ===
    "true";

  if (useTestStore && testKey) {
    return { apiKey: testKey, mode: "test" };
  }

  if (Platform.OS === "ios") {
    const apiKey = normalizeEnv(process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY);
    return apiKey ? { apiKey, mode: "production" } : null;
  }

  if (Platform.OS === "android") {
    const apiKey = normalizeEnv(
      process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
    );
    return apiKey ? { apiKey, mode: "production" } : null;
  }

  if (testKey) {
    return { apiKey: testKey, mode: "test" };
  }

  return null;
}

type DerivedRc = {
  plan: PlanId;
  activeProductId: string | null;
  expiresAt: Date | null;
  hasActiveEntitlement: boolean;
  managementUrl: string | null;
};

// Picks the highest-rank active product identifier, then resolves to a plan
// via the shared mapping. Pre-RC-purchase / unentitled users land on "free".
function deriveFromCustomerInfo(
  info: CustomerInfo | null | undefined,
  entitlementId: string,
): DerivedRc {
  if (!info) {
    return {
      plan: "free",
      activeProductId: null,
      expiresAt: null,
      hasActiveEntitlement: false,
      managementUrl: null,
    };
  }

  const active = info.entitlements?.active ?? {};
  const entitlements: PurchasesEntitlementInfo[] = Object.values(active);
  const productIds = entitlements
    .map((e) => e.productIdentifier)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const plan = resolvePlanFromRcProductIds(productIds);
  const dominantProductId =
    productIds.find((id) => isKnownRcProduct(id) && REVENUECAT_PRODUCT_TO_PLAN[id] === plan) ??
    null;

  const dominant =
    dominantProductId !== null
      ? entitlements.find((e) => e.productIdentifier === dominantProductId)
      : entitlements[0];

  const expiresAt = dominant?.expirationDate ? new Date(dominant.expirationDate) : null;

  const hasActiveEntitlement =
    plan !== "free" || Boolean(active[entitlementId]?.isActive);

  return {
    plan,
    activeProductId: dominantProductId,
    expiresAt,
    hasActiveEntitlement,
    managementUrl: info.managementURL ?? null,
  };
}

async function maybeSyncToServer(plan: PlanId, activeProductId: string | null) {
  try {
    await syncRevenueCatPlanCallable({ activeProductId });
  } catch (err) {
    // Best-effort: the RC webhook is authoritative and will reconcile.
    console.warn("[subscription] syncRevenueCatPlan failed:", err, { plan });
  }
}

export const useSubscriptionStore = create<SubscriptionState>()((set, get) => ({
  status: "idle",
  mode: null,
  plan: "free",
  activeProductId: null,
  expiresAt: null,
  entitlementId: DEFAULT_ENTITLEMENT_ID,
  managementUrl: null,
  isPro: false,

  initialize: async () => {
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      const apiConfig = getApiConfig();
      const entitlementId = getEntitlementId();
      set({ entitlementId });

      if (!apiConfig) {
        set({
          status: "unavailable",
          mode: null,
          plan: "free",
          activeProductId: null,
          expiresAt: null,
          isPro: false,
        });
        return;
      }

      try {
        await Purchases.configure({ apiKey: apiConfig.apiKey });
        Purchases.addCustomerInfoUpdateListener((info) => {
          const derived = deriveFromCustomerInfo(info, entitlementId);
          set({
            plan: derived.plan,
            activeProductId: derived.activeProductId,
            expiresAt: derived.expiresAt,
            managementUrl: derived.managementUrl,
            isPro: derived.hasActiveEntitlement,
          });
          // Fire-and-forget; webhook reconciles.
          void maybeSyncToServer(derived.plan, derived.activeProductId);
        });
        const info = await Purchases.getCustomerInfo();
        const derived = deriveFromCustomerInfo(info, entitlementId);
        set({
          status: "ready",
          mode: apiConfig.mode,
          plan: derived.plan,
          activeProductId: derived.activeProductId,
          expiresAt: derived.expiresAt,
          managementUrl: derived.managementUrl,
          isPro: derived.hasActiveEntitlement,
        });
      } catch (error) {
        console.warn("[subscription] init failed:", error);
        set({
          status: "unavailable",
          mode: null,
          plan: "free",
          activeProductId: null,
          expiresAt: null,
          managementUrl: null,
          isPro: false,
        });
      }
    })().finally(() => {
      initializationPromise = null;
    });

    return initializationPromise;
  },

  refresh: async () => {
    if (!getApiConfig()) return;
    const entitlementId = getEntitlementId();
    try {
      const info = await Purchases.getCustomerInfo();
      const derived = deriveFromCustomerInfo(info, entitlementId);
      set({
        plan: derived.plan,
        activeProductId: derived.activeProductId,
        expiresAt: derived.expiresAt,
        managementUrl: derived.managementUrl,
        isPro: derived.hasActiveEntitlement,
      });
    } catch (error) {
      console.warn("[subscription] refresh failed:", error);
    }
  },

  openManagement: async () => {
    const { managementUrl, mode } = get();

    // 1. Prefer the RC-supplied URL. RC populates this correctly for both
    //    the real App Store/Play Store AND its own test store, so this is
    //    the safe default in any mode.
    if (managementUrl) {
      try {
        const supported = await Linking.canOpenURL(managementUrl);
        if (supported) {
          await Linking.openURL(managementUrl);
          return true;
        }
      } catch (err) {
        console.warn("[subscription] openManagement(rc-url) failed:", err);
      }
    }

    // 2. If RC didn't give us one, only fall back to the real Apple/Google
    //    subscription URLs in production. Doing the fallback in test mode
    //    would send the user to App Store > Subscriptions for a sandbox
    //    purchase that lives in RC's test environment — confusing UX. In
    //    test mode we just bail.
    if (mode !== "production") return false;

    const platformFallback =
      Platform.OS === "android"
        ? PLAY_STORE_SUBSCRIPTIONS_URL
        : APP_STORE_SUBSCRIPTIONS_URL;
    try {
      const supported = await Linking.canOpenURL(platformFallback);
      if (!supported) return false;
      await Linking.openURL(platformFallback);
      return true;
    } catch (err) {
      console.warn("[subscription] openManagement(fallback) failed:", err);
      return false;
    }
  },

  // Called by store/auth.ts on every onAuthStateChanged transition. Binds the
  // RC App User ID to the Firebase uid so the RC webhook hitting our backend
  // can resolve back to the right Firestore profile.
  setRcUser: async (uid) => {
    if (get().status !== "ready") return;
    try {
      if (uid) {
        await Purchases.logIn(uid);
      } else {
        await Purchases.logOut();
      }
      // logIn/logOut both fire CustomerInfoUpdate but we proactively refresh
      // so the next render reflects the new identity even if the listener
      // hasn't fired yet on slow networks.
      await get().refresh();
    } catch (error) {
      console.warn("[subscription] setRcUser failed:", error);
    }
  },
}));
