// TrialOfferScreen
//
// One-time introductory offer shown when a free user taps "continue free" on
// the onboarding paywall. Presents a 7-day free trial for the Wingman (plus)
// plan with Apple-required auto-renewal disclosure, exact charge date, and
// cancellation instructions before the user sees the native payment sheet.
//
// Apple compliance checklist:
//   ✓ Trial duration clearly stated (7 days)
//   ✓ Price shown after trial (fetched live from RC)
//   ✓ Auto-renewal disclosure (legal footer)
//   ✓ Cancellation instructions (App Store Settings → Subscriptions)
//   ✓ Exact charge date displayed
//   ✓ "Cancel anytime" stated near the CTA

import { AppPressable } from "@/components/AppPressable";
import { MemeAvatar } from "@/components/MemeAvatar";
import { SocialProofBar } from "@/components/SocialProofBar";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { useSubscriptionStore } from "@/store/subscription";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { CalendarBlank, CheckCircle, ShieldCheck } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import Purchases from "react-native-purchases";
import { SafeAreaView } from "react-native-safe-area-context";

// The product that carries the 7-day free trial intro offer.
const TRIAL_PRODUCT = {
  test: "monthly_2",
  production: "memeaiplus",
} as const;

function formatChargeDate(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

interface TrialOfferScreenProps {
  onDecline: () => void;
}

export function TrialOfferScreen({ onDecline }: TrialOfferScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  // "Cancel anytime" reassurance names the store the purchase routes to.
  const paywallNote =
    Platform.OS === "android"
      ? t("settings.plan.paywallNotePlay")
      : t("settings.plan.paywallNote");
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;

  const subscriptionStatus = useSubscriptionStore((s) => s.status);
  const subscriptionMode = useSubscriptionStore((s) => s.mode);
  const refresh = useSubscriptionStore((s) => s.refresh);

  const productId =
    TRIAL_PRODUCT[subscriptionMode === "test" ? "test" : "production"];

  const [priceString, setPriceString] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chargeDate = formatChargeDate();

  // Fetch live price from RC so the disclosure shows the actual charge amount.
  useEffect(() => {
    if (subscriptionStatus !== "ready") return;
    let cancelled = false;
    (async () => {
      try {
        const offerings = await Purchases.getOfferings();
        const pkg = offerings.current?.availablePackages.find(
          (p) => p.product.identifier === productId,
        );
        if (!cancelled && pkg) {
          setPriceString(pkg.product.priceString);
        }
      } catch {
        // price stays null → fallback copy shown
      }
    })();
    return () => { cancelled = true; };
  }, [subscriptionStatus, productId]);

  const handleStartTrial = async () => {
    if (subscriptionStatus !== "ready") {
      Alert.alert(t("settings.plan.heading"), paywallNote);
      return;
    }
    setBusy(true);
    try {
      const offerings = await Purchases.getOfferings();
      const pkg = offerings.current?.availablePackages.find(
        (p) => p.product.identifier === productId,
      );
      if (!pkg) {
        Alert.alert(t("settings.plan.heading"), paywallNote);
        return;
      }
      await Purchases.purchasePackage(pkg);
      await refresh();
      // effectivePlan change in OnboardingFlow will call finish() automatically
    } catch (err: unknown) {
      // RC throws with userCancelled flag — silently ignore cancellations
      if (err && typeof err === "object" && "userCancelled" in err && err.userCancelled) {
        return;
      }
      Alert.alert(t("onboarding.trial.errorTitle"), t("onboarding.trial.errorBody"));
    } finally {
      setBusy(false);
    }
  };

  const features = t("onboarding.trial.features", { returnObjects: true }) as string[];

  const chargeBody = priceString
    ? t("onboarding.trial.chargeBody", { price: priceString, date: chargeDate })
    : t("onboarding.trial.chargeBodyFallback", { date: chargeDate });

  const legalText = priceString
    ? t("onboarding.trial.legal", { price: priceString })
    : t("onboarding.trial.legalFallback");

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 20,
            paddingBottom: 32,
            gap: 20,
            alignItems: "center",
          }}
        >
          {/* ONE-TIME OFFER badge */}
          <Animated.View entering={FadeIn.duration(300)}>
            <View
              style={{
                paddingHorizontal: 14,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: theme["--color-primary"],
              }}
            >
              <Typography
                style={{
                  color: "#FFFFFF",
                  fontSize: 11,
                  fontWeight: "800",
                  letterSpacing: 1.2,
                }}
              >
                {t("onboarding.trial.badge")}
              </Typography>
            </View>
          </Animated.View>

          {/* Avatar */}
          <Animated.View entering={FadeIn.duration(400).delay(80)}>
            <MemeAvatar variant="cool" size={80} pulse />
          </Animated.View>

          {/* Headline + subhead */}
          <Animated.View
            entering={FadeInDown.duration(380).delay(120)}
            style={{ alignItems: "center", gap: 8 }}
          >
            <Typography
              family="display"
              weight="bold"
              style={{
                color: theme["--color-foreground"],
                fontSize: 30,
                lineHeight: 36,
                textAlign: "center",
              }}
            >
              {t("onboarding.trial.headline")}
            </Typography>
            <Typography
              variant="body"
              style={{
                color: theme["--color-foreground-secondary"],
                textAlign: "center",
              }}
            >
              {t("onboarding.trial.subhead")}
            </Typography>
          </Animated.View>

          {/* Feature chips */}
          <Animated.View
            entering={FadeInDown.duration(360).delay(180)}
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "center",
              width: "100%",
            }}
          >
            {features.map((feat) => (
              <View
                key={feat}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: theme["--color-primary-subtle"],
                  borderWidth: 1,
                  borderColor: theme["--color-primary-muted"],
                }}
              >
                <CheckCircle
                  size={14}
                  color={theme["--color-primary"]}
                  weight="fill"
                />
                <Typography
                  variant="body-sm"
                  style={{
                    color: theme["--color-foreground"],
                    fontWeight: "700",
                  }}
                >
                  {feat}
                </Typography>
              </View>
            ))}
          </Animated.View>

          {/* Social proof — real App Store review, placed right before the
              charge disclosure so the reassurance lands just ahead of the
              money details. */}
          <Animated.View
            entering={FadeInDown.duration(360).delay(220)}
            style={{ width: "100%" }}
          >
            <SocialProofBar />
          </Animated.View>

          {/* Charge disclosure card */}
          <Animated.View
            entering={FadeInDown.duration(360).delay(240)}
            style={{ width: "100%" }}
          >
            <View
              style={{
                backgroundColor: theme["--color-card"],
                borderRadius: 16,
                borderWidth: 1,
                borderColor: theme["--color-border"],
                padding: 16,
                gap: 10,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <CalendarBlank
                  size={18}
                  color={theme["--color-primary"]}
                  weight="bold"
                />
                <Typography
                  variant="body-sm"
                  style={{
                    color: theme["--color-foreground"],
                    fontWeight: "700",
                    flex: 1,
                  }}
                >
                  {t("onboarding.trial.chargeTitle")}
                </Typography>
              </View>
              <Typography
                variant="body-sm"
                style={{
                  color: theme["--color-foreground-secondary"],
                  lineHeight: 20,
                }}
              >
                {chargeBody}
              </Typography>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 6,
                  paddingTop: 4,
                  borderTopWidth: 1,
                  borderTopColor: theme["--color-border"],
                }}
              >
                <ShieldCheck
                  size={14}
                  color={theme["--color-foreground-muted"]}
                  weight="fill"
                  style={{ marginTop: 1 }}
                />
                <Typography
                  variant="caption"
                  style={{ color: theme["--color-foreground-muted"], flex: 1 }}
                >
                  {t("onboarding.trial.cancelInstructions")}
                </Typography>
              </View>
            </View>
          </Animated.View>

          {/* Primary CTA — gradient */}
          <Animated.View
            entering={FadeInDown.duration(340).delay(300)}
            style={{ width: "100%" }}
          >
            <AppPressable
              accessibilityLabel={t("onboarding.trial.cta")}
              disabled={busy}
              onPress={() => void handleStartTrial()}
              haptic
              feedback="opacity"
              style={{
                height: 58,
                borderRadius: 29,
                overflow: "hidden",
                opacity: busy ? 0.7 : 1,
              }}
            >
              <LinearGradient
                colors={gradient.colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 20,
                }}
              >
                <Typography
                  variant="title-sm"
                  style={{ color: "#FFFFFF", fontWeight: "800" }}
                >
                  {t("onboarding.trial.cta")}
                </Typography>
              </View>
            </AppPressable>
          </Animated.View>

          {/* Decline link */}
          <Animated.View entering={FadeInDown.duration(300).delay(340)}>
            <AppPressable
              onPress={onDecline}
              disabled={busy}
              feedback="opacity"
              hitSlop={12}
              accessibilityLabel={t("onboarding.trial.decline")}
              style={{ paddingVertical: 4 }}
            >
              <Typography
                variant="caption"
                style={{
                  color: theme["--color-foreground-muted"],
                  textDecorationLine: "underline",
                }}
              >
                {t("onboarding.trial.decline")}
              </Typography>
            </AppPressable>
          </Animated.View>

          {/* Apple-required legal disclosure */}
          <Animated.View
            entering={FadeIn.duration(300).delay(380)}
            style={{ width: "100%" }}
          >
            <Typography
              variant="caption"
              style={{
                color: theme["--color-foreground-muted"],
                textAlign: "center",
                lineHeight: 16,
                fontSize: 10,
              }}
            >
              {legalText}
              {Platform.OS === "ios"
                ? ""
                : " Manage in Google Play → Subscriptions."}
            </Typography>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
