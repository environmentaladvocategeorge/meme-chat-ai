import { MaxWidthFrame } from "@/components/MaxWidthFrame";
import { PlayfulMenu } from "@/components/PlayfulMenu";
import { useTheme } from "@/hooks/useTheme";
import { Stack } from "expo-router";
import { View } from "react-native";

export default function AppLayout() {
  const theme = useTheme();

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
    </View>
  );
}
