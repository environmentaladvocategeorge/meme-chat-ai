import type { InterstitialAdResult } from "@/domain/ads/interstitialAds";
import { create } from "zustand";

// Dev-only fake interstitial.
//
// In local dev (Expo Go or a dev build) the real AdMob interstitial usually
// can't render — no native module in Expo Go, no production ad unit — so the ad
// cadence is invisible and impossible to eyeball. This store drives a visible
// placeholder overlay (see components/ads/DevInterstitialAd) that stands in for
// the real ad ONLY when __DEV__ is true, so you can confirm the cadence fires at
// the right moments. Free-user gating still lives in useInterstitialAdGate, so
// this never shows to a paid user. It is never used in a production build.

type DevInterstitialState = {
  visible: boolean;
  // Resolver for the promise returned by the in-flight show(). Dismissing the
  // overlay resolves it, which lets useInterstitialAdGate clear `pending` and
  // advance exactly like the real ad's CLOSED event would.
  resolve: (() => void) | null;
  show: () => Promise<void>;
  dismiss: () => void;
};

export const useDevInterstitialStore = create<DevInterstitialState>(
  (set, get) => ({
    visible: false,
    resolve: null,
    show: () =>
      new Promise<void>((resolve) => {
        // If one is somehow already up, settle it first so its waiter never
        // hangs, then take over.
        get().resolve?.();
        set({ visible: true, resolve });
      }),
    dismiss: () => {
      const { resolve } = get();
      set({ visible: false, resolve: null });
      resolve?.();
    },
  }),
);

// Promise-shaped to match showInterstitialAd, so useInterstitialAdGate can swap
// it in for __DEV__ without any other change. Resolves when the overlay closes.
export async function showDevInterstitialAd(): Promise<InterstitialAdResult> {
  await useDevInterstitialStore.getState().show();
  return { shown: true, placeholder: true };
}
