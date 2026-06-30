// useInterstitialAdGate
//
// Shows an interstitial ad to confirmed-free users once the ad cadence arms it.
// Two cadences flip adGate.pending (see store/adGate.ts):
//   1. every AD_INTERVAL successfully streamed replies (recordReplyCompleted),
//      so the ad lands right after a reply finishes streaming; and
//   2. the "create a bot" tap schedule (recordNewBotClick) — first ad after a
//      few taps, then periodically.
// This hook reacts to pending and plays the ad, gating it to confirmed-free
// users so no paying user ever sees one.
//
// Mounted in the (app) layout so it fires regardless of which in-app screen the
// trigger lands on (the new-bot tap navigates to the creator).

import { showInterstitialAd } from "@/domain/ads/interstitialAds";
import { useAdGateStore } from "@/store/adGate";
import { showDevInterstitialAd } from "@/store/devInterstitial";
import { useAdsAllowed } from "@/store/entitlement";
import { useEffect, useRef } from "react";

// In local dev the real AdMob interstitial can't render (no native module in
// Expo Go, no production unit), so we swap in a visible placeholder overlay (see
// DevInterstitialAd) to make the cadence testable. Production always uses the
// real ad.
const presentInterstitial = __DEV__ ? showDevInterstitialAd : showInterstitialAd;

// Kill-switch parity with the banner (AdBanner reads the same flag). It disables
// the REAL ad only — the dev placeholder ignores it so the cadence stays
// testable locally even with ads switched off in .env.
const adsEnabled = process.env.EXPO_PUBLIC_ADS_ENABLED !== "false";

export function useInterstitialAdGate(): void {
  const pending = useAdGateStore((s) => s.pending);
  const clearPending = useAdGateStore((s) => s.clearPending);
  // Positively-confirmed-free gate — the same source the banner uses. Stays
  // false until both plan sources resolve, so a paying user (or one still
  // loading) never gets an ad.
  const adsAllowed = useAdsAllowed();
  // Guards against a second show while one ad is mid-flight (loading/visible).
  const showing = useRef(false);

  useEffect(() => {
    if (!pending) return;

    // Not a confirmed-free user — drop the trigger without showing anything, so
    // a later downgrade can't replay a stale ad the moment the plan resolves.
    // Same for the production kill-switch (the dev placeholder ignores it).
    if (!adsAllowed || (!__DEV__ && !adsEnabled)) {
      clearPending();
      return;
    }

    if (showing.current) return;
    showing.current = true;

    let active = true;
    void presentInterstitial()
      // A failed/placeholder ad is a no-op for the user; either way the
      // cadence advances so we don't get stuck re-arming the same trigger.
      .catch(() => {})
      .finally(() => {
        if (!active) return;
        showing.current = false;
        clearPending();
      });

    return () => {
      active = false;
    };
  }, [pending, adsAllowed, clearPending]);
}
