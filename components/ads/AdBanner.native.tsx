import { Typography } from "@/components/Typography";
import { canUseNativeAds } from "@/domain/ads/mobileAds";
import { themes } from "@/nativewind-theme";
import { useSubscriptionStore } from "@/store/subscription";
import Constants from "expo-constants";
import { useColorScheme } from "nativewind";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StyleProp, ViewStyle } from "react-native";
import { Platform, View } from "react-native";

type AdBannerProps = {
  style?: StyleProp<ViewStyle>;
};

type GoogleMobileAdsModule = typeof import("react-native-google-mobile-ads");

function getConfiguredBannerId() {
  const configuredId = Platform.select({
    ios: process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER_ID,
    android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID,
    default: undefined,
  });

  if (!configuredId || configuredId.startsWith("REPLACE_WITH_")) {
    return undefined;
  }

  return configuredId;
}

export function AdBanner({ style }: AdBannerProps) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const theme = themes[colorScheme ?? "light"];
  const isPro = useSubscriptionStore((s) => s.isPro);
  const [adsModule, setAdsModule] = useState<GoogleMobileAdsModule | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const adsEnabled = process.env.EXPO_PUBLIC_ADS_ENABLED !== "false";
  const nativeAdsAvailable = canUseNativeAds();
  const showExpoGoPlaceholder =
    __DEV__ &&
    adsEnabled &&
    !isPro &&
    (Constants.appOwnership === "expo" || !nativeAdsAvailable);

  useEffect(() => {
    setFailed(false);
  }, [isPro]);

  useEffect(() => {
    let mounted = true;

    if (!adsEnabled || isPro || !nativeAdsAvailable) return;

    import("react-native-google-mobile-ads")
      .then((module) => {
        if (mounted) setAdsModule(module);
      })
      .catch(() => {
        if (mounted) setFailed(true);
      });

    return () => {
      mounted = false;
    };
  }, [adsEnabled, isPro, nativeAdsAvailable]);

  const unitId = useMemo(
    () =>
      getConfiguredBannerId() ??
      (__DEV__ && adsModule ? adsModule.TestIds.BANNER : undefined),
    [adsModule],
  );

  if (showExpoGoPlaceholder) {
    return (
      <View
        style={[
          {
            minHeight: 56,
            borderRadius: 5,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme["--color-card-muted"],
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: theme["--color-border-strong"],
          },
          style,
        ]}
      >
        <Typography
          variant="caption"
          style={{ color: theme["--color-foreground-muted"] }}
        >
          {t("ads.placeholder")}
        </Typography>
      </View>
    );
  }

  if (
    !adsEnabled ||
    isPro ||
    failed ||
    !adsModule ||
    !unitId ||
    !nativeAdsAvailable
  ) {
    return null;
  }

  const BannerAd = adsModule.BannerAd;

  return (
    <View
      style={[
        {
          minHeight: 56,
          borderRadius: 5,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        },
        style,
      ]}
    >
      <BannerAd
        unitId={unitId}
        size={adsModule.BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}
