import { DevInterstitialAd } from "@/components/ads/DevInterstitialAd";
import { MaxWidthFrame } from "@/components/MaxWidthFrame";
import { PlayfulMenu } from "@/components/PlayfulMenu";
import { ReviewPrompt } from "@/components/ReviewPrompt";
import { useDailyPaywall } from "@/hooks/useDailyPaywall";
import { useInterstitialAdGate } from "@/hooks/useInterstitialAdGate";
import { useTheme } from "@/hooks/useTheme";
import { useAdGateStore } from "@/store/adGate";
import { useReviewPromptStore } from "@/store/reviewPrompt";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

export default function AppLayout() {
  const theme = useTheme();
  const hydrateReviewPrompt = useReviewPromptStore((s) => s.hydrate);
  const hydrateAdGate = useAdGateStore((s) => s.hydrate);

  // Once-a-day paywall for free users on cold start. Lives here because this
  // layout only mounts post-login + post-onboarding. The first-message-of-the-
  // day trigger is handled by useOnSendEffects in the chat screen.
  useDailyPaywall();

  // Free-tier interstitial ad, armed by the ad cadence (every N completed
  // replies, and on a "create a bot" tap schedule). Mounted here — not on the
  // chat screen — so it fires no matter which in-app screen the trigger lands
  // on (the new-bot tap navigates to the creator).
  useInterstitialAdGate();

  useEffect(() => {
    void hydrateReviewPrompt();
    void hydrateAdGate();
  }, [hydrateReviewPrompt, hydrateAdGate]);

  // The in-app screens (chat/history/settings) get the phone-width column on
  // wide screens (iPad). The full-bleed brand pages — landing, auth,
  // onboarding — are intentionally left unconstrained at the root so their
  // gradients reach edge-to-edge instead of sitting in a column with mismatched
  // gutters. Here the gutter color matches the screens' own background, so the
  // constraint is invisible on the standard (theme-background) screens.
  // PlayfulMenu sits OUTSIDE MaxWidthFrame so its full-screen dim backdrop
  // covers the whole device on wide screens instead of being clipped to the
  // content column. The menu itself re-aligns its pills to the same column
  // width internally, so they still line up under the header's menu button.
  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <MaxWidthFrame backgroundColor={theme["--color-background"]}>
        <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme["--color-background"] },
              animation: "slide_from_right",
            }}
          >
            <Stack.Screen name="chat" />
            <Stack.Screen name="history" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="plan" />
            {/* No swipe-back: the creator has unsaved-draft state, so the only
                exit is its X menu (Save draft / Discard), never an accidental
                edge-swipe. Hardware back is intercepted in the screen. */}
            <Stack.Screen name="persona-creator" options={{ gestureEnabled: false }} />
          </Stack>
        </View>
      </MaxWidthFrame>

      <PlayfulMenu />
      <ReviewPrompt />
      {/* Dev-only fake interstitial overlay; renders null in production. */}
      <DevInterstitialAd />
    </View>
  );
}
