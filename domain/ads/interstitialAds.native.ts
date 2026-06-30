import { canUseNativeAds } from "./mobileAds";
import { Platform } from "react-native";

export type InterstitialAdResult = {
  shown: boolean;
  placeholder: boolean;
};

type GoogleMobileAdsModule = typeof import("react-native-google-mobile-ads");

function getInterstitialAdUnitId(module: GoogleMobileAdsModule) {
  const configuredId = Platform.select({
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_ID,
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_ID,
    default: undefined,
  });

  if (configuredId && !configuredId.startsWith("REPLACE_WITH_")) {
    return configuredId;
  }

  return __DEV__ ? module.TestIds.INTERSTITIAL : undefined;
}

export async function showInterstitialAd(): Promise<InterstitialAdResult> {
  if (!canUseNativeAds()) {
    return {
      shown: false,
      placeholder: true,
    };
  }

  const adsModule = await import("react-native-google-mobile-ads");
  const unitId = getInterstitialAdUnitId(adsModule);

  if (!unitId) {
    return {
      shown: false,
      placeholder: true,
    };
  }

  return new Promise((resolve, reject) => {
    const interstitial = adsModule.InterstitialAd.createForAdRequest(unitId, {
      requestNonPersonalizedAdsOnly: true,
    });
    let opened = false;
    let settled = false;

    const cleanupCallbacks: (() => void)[] = [];
    const cleanup = () => {
      cleanupCallbacks.splice(0).forEach((callback) => callback());
    };
    const settle = (result: InterstitialAdResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    cleanupCallbacks.push(
      interstitial.addAdEventListener(adsModule.AdEventType.LOADED, () => {
        void interstitial.show();
      }),
      interstitial.addAdEventListener(adsModule.AdEventType.OPENED, () => {
        opened = true;
      }),
      interstitial.addAdEventListener(adsModule.AdEventType.CLOSED, () => {
        settle({
          shown: opened,
          placeholder: false,
        });
      }),
      interstitial.addAdEventListener(adsModule.AdEventType.ERROR, (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }),
    );

    interstitial.load();
  });
}
