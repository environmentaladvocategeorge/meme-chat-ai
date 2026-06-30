import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useDevInterstitialStore } from "@/store/devInterstitial";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";

// Dev-only placeholder that stands in for a real interstitial ad so the ad
// cadence is visible in local dev (Expo Go / dev builds), where AdMob can't
// render. Renders nothing in a production build (__DEV__ guard) and is only ever
// shown for confirmed-free users (the gate decides — see useInterstitialAdGate).
// Closing it resolves the gate's promise exactly like a real interstitial's
// CLOSED event, so the cadence advances identically.

const AUTO_DISMISS_MS = 3500;

export function DevInterstitialAd() {
  const theme = useTheme();
  const visible = useDevInterstitialStore((s) => s.visible);
  const dismiss = useDevInterstitialStore((s) => s.dismiss);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Auto-dismiss after a short beat, with a countdown so it behaves like a
  // skippable interstitial rather than a dialog that traps the tester.
  useEffect(() => {
    if (!visible) return;
    setSecondsLeft(Math.ceil(AUTO_DISMISS_MS / 1000));
    const tick = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [visible, dismiss]);

  if (!__DEV__ || !visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.85)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 340,
            borderRadius: 16,
            paddingVertical: 28,
            paddingHorizontal: 24,
            alignItems: "center",
            gap: 16,
            backgroundColor: theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-border"],
          }}
        >
          <Typography
            variant="caption"
            style={{ color: theme["--color-foreground-muted"], letterSpacing: 1 }}
          >
            DEV · FAKE AD
          </Typography>
          <Typography
            variant="title-md"
            style={{ color: theme["--color-foreground"], textAlign: "center" }}
          >
            Fake Interstitial Ad
          </Typography>
          <ActivityIndicator color={theme["--color-primary"]} />
          <Typography
            variant="caption"
            style={{
              color: theme["--color-foreground-muted"],
              textAlign: "center",
            }}
          >
            Standing in for a real ad so you can test the cadence. Free users,
            local builds only.
          </Typography>
          <Pressable
            onPress={dismiss}
            accessibilityRole="button"
            style={{
              marginTop: 8,
              paddingVertical: 10,
              paddingHorizontal: 22,
              borderRadius: 999,
              backgroundColor: theme["--color-primary"],
            }}
          >
            <Typography
              variant="label"
              style={{ color: theme["--color-primary-foreground"] }}
            >
              {secondsLeft > 0 ? `Skip ad (${secondsLeft})` : "Close"}
            </Typography>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
