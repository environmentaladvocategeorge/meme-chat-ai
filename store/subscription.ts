import { Platform } from "react-native";
import Purchases, { type CustomerInfo } from "react-native-purchases";
import { create } from "zustand";

type SubscriptionMode = "test" | "production";
type SubscriptionStatus = "idle" | "ready" | "unavailable";

interface SubscriptionState {
  status: SubscriptionStatus;
  mode: SubscriptionMode | null;
  isPro: boolean;
  entitlementId: string;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DEFAULT_ENTITLEMENT_ID = "pro";

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

function isEntitled(info: CustomerInfo | null | undefined, entitlementId: string) {
  if (!info) return false;
  const active = info.entitlements?.active ?? {};
  if (active[entitlementId]?.isActive) return true;
  return Object.keys(active).length > 0;
}

// RevenueCat is scaffolded but optional. If API keys are missing the store
// stays in `"unavailable"` and `isPro` is always false; the rest of the
// app keeps running. Wire keys in `.env` to flip it on.
export const useSubscriptionStore = create<SubscriptionState>()((set) => ({
  status: "idle",
  mode: null,
  isPro: false,
  entitlementId: DEFAULT_ENTITLEMENT_ID,

  initialize: async () => {
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      const apiConfig = getApiConfig();
      const entitlementId = getEntitlementId();
      set({ entitlementId });

      if (!apiConfig) {
        set({ status: "unavailable", mode: null, isPro: false });
        return;
      }

      try {
        await Purchases.configure({ apiKey: apiConfig.apiKey });
        Purchases.addCustomerInfoUpdateListener((info) => {
          set({ isPro: isEntitled(info, entitlementId) });
        });
        const info = await Purchases.getCustomerInfo();
        set({
          status: "ready",
          mode: apiConfig.mode,
          isPro: isEntitled(info, entitlementId),
        });
      } catch (error) {
        console.warn("[subscription] init failed:", error);
        set({ status: "unavailable", mode: null, isPro: false });
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
      set({ isPro: isEntitled(info, entitlementId) });
    } catch (error) {
      console.warn("[subscription] refresh failed:", error);
    }
  },
}));
