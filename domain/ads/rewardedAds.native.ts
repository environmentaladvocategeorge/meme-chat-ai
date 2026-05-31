import { canUseNativeAds } from "./mobileAds";
import { Platform } from "react-native";

export type RewardedAdResult = {
  rewardEarned: boolean;
  placeholder: boolean;
};

type GoogleMobileAdsModule = typeof import("react-native-google-mobile-ads");

function getRewardedAdUnitId(module: GoogleMobileAdsModule) {
  const configuredId = Platform.select({
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_REWARDED_ID,
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_ID,
    default: undefined,
  });

  if (configuredId && !configuredId.startsWith("REPLACE_WITH_")) {
    return configuredId;
  }

  return __DEV__ ? module.TestIds.REWARDED : undefined;
}

export async function showRewardedInsightAd(): Promise<RewardedAdResult> {
  if (!canUseNativeAds()) {
    return {
      rewardEarned: __DEV__,
      placeholder: true,
    };
  }

  const adsModule = await import("react-native-google-mobile-ads");
  const unitId = getRewardedAdUnitId(adsModule);

  if (!unitId) {
    return {
      rewardEarned: false,
      placeholder: true,
    };
  }

  return new Promise((resolve, reject) => {
    const rewardedAd = adsModule.RewardedAd.createForAdRequest(unitId, {
      requestNonPersonalizedAdsOnly: true,
    });
    let earnedReward = false;
    let settled = false;

    const cleanupCallbacks: Array<() => void> = [];
    const cleanup = () => {
      cleanupCallbacks.splice(0).forEach((callback) => callback());
    };
    const settle = (result: RewardedAdResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    cleanupCallbacks.push(
      rewardedAd.addAdEventListener(adsModule.RewardedAdEventType.LOADED, () => {
        void rewardedAd.show();
      }),
      rewardedAd.addAdEventListener(
        adsModule.RewardedAdEventType.EARNED_REWARD,
        () => {
          earnedReward = true;
        },
      ),
      rewardedAd.addAdEventListener(adsModule.AdEventType.CLOSED, () => {
        settle({
          rewardEarned: earnedReward,
          placeholder: false,
        });
      }),
      rewardedAd.addAdEventListener(adsModule.AdEventType.ERROR, (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }),
    );

    rewardedAd.load();
  });
}
