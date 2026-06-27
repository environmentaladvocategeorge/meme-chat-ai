import { IconButton } from "@/components/IconButton";
import { useTheme } from "@/hooks/useTheme";
import { NotePencil } from "phosphor-react-native";
import { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// Right-hand header action on the chat screen: starts a fresh conversation.
// Deliberately a softer treatment than the gradient menu button — a muted
// outlined circle — so it reads as secondary and doesn't fight for attention.
// Built on IconButton so it shares the app-wide static-target + inner-feedback
// touch core (the thing that keeps small targets reliable on Fabric release).
//
// The button only makes sense once there's a session/messages to clear, so it
// fades in/out with `visible` rather than mounting/unmounting (a hard pop reads
// as janky). We animate opacity via useAnimatedStyle — NOT a Reanimated
// `entering`/`exiting` layout animation, which leaves the child's native
// hit-test frame unsynced on Fabric/release and drops the first tap(s). The
// component stays mounted; `pointerEvents` gates taps while it's faded out.
//
// The IconButton is glass, and opacity 0 on a glass ancestor permanently blanks
// the native material (expo-glass-effect bug). So we feed the same `opacity`
// SharedValue to the glass layer as `glassFadeProgress`: it flips the material
// to 'none' near 0, letting the wrapper opacity fade to a true 0 without killing
// the glass. See GlassSurface's opacity-0 note + fadeProgress.
export function NewConversationButton({
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
        hitSlop={16}
        glass
        glassFadeProgress={opacity}
        fallbackStyle={{
          borderWidth: 1,
          borderColor: theme["--color-border"],
          backgroundColor: theme["--color-card-muted"],
        }}
      >
        <NotePencil
          size={20}
          color={theme["--color-foreground"]}
          weight="bold"
        />
      </IconButton>
    </Animated.View>
  );
}
