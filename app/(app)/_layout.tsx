import { MaxWidthFrame } from "@/components/MaxWidthFrame";
import { PlayfulMenu } from "@/components/PlayfulMenu";
import { ReviewPrompt } from "@/components/ReviewPrompt";
import { useDailyPaywall } from "@/hooks/useDailyPaywall";
import { useTheme } from "@/hooks/useTheme";
import { useReviewPromptStore } from "@/store/reviewPrompt";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

export default function AppLayout() {
  const theme = useTheme();
  const hydrateReviewPrompt = useReviewPromptStore((s) => s.hydrate);

  // Once-a-day paywall for free users on cold start. Lives here because this
  // layout only mounts post-login + post-onboarding. The first-message-of-the-
  // day trigger is handled by useOnSendEffects in the chat screen.
  useDailyPaywall();

  useEffect(() => {
    void hydrateReviewPrompt();
  }, [hydrateReviewPrompt]);

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
          </Stack>
        </View>
      </MaxWidthFrame>

      <PlayfulMenu />
      <ReviewPrompt />
    </View>
  );
}
