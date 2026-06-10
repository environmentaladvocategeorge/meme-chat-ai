// Floating "jump to latest" affordance for the chat thread. Appears once the
// user has scrolled a couple hundred px up into history and smooth-scrolls
// back to the newest message on tap.
//
// Same fade discipline as NewConversationButton: always mounted, opacity via
// useAnimatedStyle (NOT entering/exiting layout animations, which desync the
// native hit-test frame on Fabric/release and drop the first taps), and
// pointerEvents gates touches while hidden. Built on IconButton so the press
// itself rides the shared static-target + inner-feedback touch core.

import { IconButton } from "@/components/IconButton";
import { useTheme } from "@/hooks/useTheme";
import { ArrowDown } from "phosphor-react-native";
import { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export function ScrollToBottomButton({
  label,
  onPress,
  visible,
}: {
  label: string;
  onPress: () => void;
  visible: boolean;
}) {
  const theme = useTheme();

  const opacity = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: 200 });
  }, [visible, opacity]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={fadeStyle} pointerEvents={visible ? "auto" : "none"}>
      <IconButton
        onPress={onPress}
        accessibilityLabel={label}
        size={40}
        hitSlop={10}
        surfaceStyle={{
          borderWidth: 1,
          borderColor: theme["--color-border"],
          backgroundColor: theme["--color-card"],
          // Floats over message content, so a whisper of elevation separates
          // it — a circle has no concave notches for the shadow to pool in
          // (the thing that retired the header's shadow). Shadow color is
          // pinned to black: a theme-foreground shadow flips to near-white
          // in dark mode and reads as a glow, not a shadow.
          shadowColor: "#000000",
          shadowOpacity: 0.08,
          shadowRadius: 5,
          shadowOffset: { width: 0, height: 2 },
          elevation: 2,
        }}
      >
        <ArrowDown size={20} color={theme["--color-primary"]} weight="bold" />
      </IconButton>
    </Animated.View>
  );
}
