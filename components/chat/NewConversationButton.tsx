import { useTheme } from "@/hooks/useTheme";
import { tapHaptic } from "@/lib/haptics";
import { NotePencil } from "phosphor-react-native";
import { Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Right-hand header action on the chat screen: starts a fresh conversation.
// Deliberately a softer treatment than the gradient menu button — a muted
// outlined circle — so it reads as secondary and doesn't fight for attention.
const SPRING = { damping: 14, stiffness: 220, mass: 0.8 } as const;

export function NewConversationButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  // Press feedback (and the visual circle) live on a pointerEvents="none" child
  // so the Pressable's own box never animates. Animating the touch target — or
  // wrapping it in an `entering` animation — desyncs Fabric's hit-test frame in
  // release builds, which is what made this button drop taps. onPressIn drives
  // the flinch the instant a finger lands, so a dropped tap is now visible.
  const pressed = useSharedValue(0);
  const visualStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.12 }],
  }));

  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 80 });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, SPRING);
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={16}
      style={{
        width: 40,
        height: 40,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme["--color-border"],
            backgroundColor: theme["--color-card-muted"],
          },
          visualStyle,
        ]}
      >
        <NotePencil
          size={20}
          color={theme["--color-foreground"]}
          weight="bold"
        />
      </Animated.View>
    </Pressable>
  );
}
