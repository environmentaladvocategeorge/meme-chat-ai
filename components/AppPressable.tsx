// The single touch core every interactive element in the app routes through
// (the menu button is the one deliberate exception — it stays bespoke).
//
// Why this exists: on the New Architecture (Fabric), animating a touch target's
// own box — a `transform`/animated style on the Pressable, an
// `Animated.createAnimatedComponent(Pressable)`, or an `entering` layout
// animation wrapping it — desyncs the native hit-test frame from the visual
// frame in RELEASE builds (never in Expo Go / dev). Small targets (~40px) then
// drop taps until a re-layout refreshes the frame; this was the "spam-tap until
// it registers" bug on the camera / new-chat / menu buttons. Wide targets
// absorb the offset, which is why the composer pills next to the camera felt
// fine. The sibling app (HobbyDex) never hit this because it funnels nearly
// everything through one static primitive and never animates a small target.
//
// The discipline encoded here:
//   1. The touch target is a STATIC Pressable. Its box is never animated.
//   2. All press feedback lives on an inner <Animated.View pointerEvents="none">
//      driven by onPressIn/onPressOut shared values, so the finger sees an
//      instant flinch (a missing flinch = the tap was dropped) without ever
//      moving the hit frame.
//   3. Inside a bottom sheet the touch target must be gesture-handler's
//      Pressable, not RN's, or it fights the sheet's pan gesture. That swap is
//      automatic via TouchableBaseContext + <SheetTouchableProvider> — call
//      sites never decide.

import { tapHaptic } from "@/lib/haptics";
import { Pressable as GHPressable } from "react-native-gesture-handler";
import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Pressable as RNPressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Matches the press spring used by the proven hand-fixed buttons (menu, photo,
// new-chat) so every target flinches identically.
const PRESS_SPRING = { damping: 14, stiffness: 220, mass: 0.8 } as const;

// The underlying touch component. RN's Pressable everywhere by default; swapped
// for gesture-handler's (same prop surface) inside a sheet via the provider.
type TouchableComponent = ComponentType<PressableProps>;
const TouchableBaseContext = createContext<TouchableComponent>(
  RNPressable as TouchableComponent,
);

// Drop this once around a bottom sheet's content so every AppPressable /
// IconButton / Button beneath it uses the gesture-handler touch core.
export function SheetTouchableProvider({ children }: { children: ReactNode }) {
  return (
    <TouchableBaseContext.Provider value={GHPressable as TouchableComponent}>
      {children}
    </TouchableBaseContext.Provider>
  );
}

type Feedback = "scale" | "opacity" | "none";

export interface AppPressableProps {
  onPress?: () => void;
  onLongPress?: () => void;
  // Long-press recognition delay (ms). Only relevant with onLongPress.
  delayLongPress?: number;
  children: ReactNode;
  // How the surface reacts to a press. "scale" (default) shrinks the inner
  // surface; "opacity" dims it; "none" renders children directly with no inner
  // wrapper (use for containers that hold their own nested touchables).
  feedback?: Feedback;
  // How far the surface shrinks at full press, for feedback="scale". Icon
  // buttons want a touch more (0.08); large surfaces want less (0.04).
  pressScale?: number;
  // Fire a light haptic on press. On for affordances you want to feel
  // (icon buttons, primary actions); off for list rows / chips by default.
  haptic?: boolean;
  disabled?: boolean;
  // Defaults to a comfortable 8px all round; the whole point is to forgive the
  // edges of small targets.
  hitSlop?: PressableProps["hitSlop"];
  // Surface style — bg / border / radius / padding. Applied to the inner
  // animated view that scales. NOTE: with feedback="none" there is no inner
  // view (children render directly so nested touchables work), so `style` is
  // ignored — put the box styling on containerStyle in that case.
  style?: StyleProp<ViewStyle>;
  // Layout style for the static hit target — width / height / flex / alignSelf
  // / margin. Keep sizing here so the hit frame is correct and never animates.
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: PressableProps["accessibilityRole"];
  accessibilityState?: PressableProps["accessibilityState"];
  accessibilityHint?: PressableProps["accessibilityHint"];
  testID?: string;
}

export function AppPressable({
  onPress,
  onLongPress,
  delayLongPress,
  children,
  feedback = "scale",
  pressScale = 0.06,
  haptic = false,
  disabled = false,
  hitSlop = 8,
  style,
  containerStyle,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  accessibilityHint,
  testID,
}: AppPressableProps) {
  const Touchable = useContext(TouchableBaseContext);

  const pressed = useSharedValue(0);
  const visualStyle = useAnimatedStyle(() => {
    if (feedback === "opacity") {
      return { opacity: 1 - pressed.value * 0.18 };
    }
    return { transform: [{ scale: 1 - pressed.value * pressScale }] };
  });

  const handlePress = () => {
    if (haptic) tapHaptic();
    onPress?.();
  };

  return (
    <Touchable
      onPress={onPress ? handlePress : undefined}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 80 });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, PRESS_SPRING);
      }}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={
        disabled
          ? { ...accessibilityState, disabled: true }
          : accessibilityState
      }
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={containerStyle}
    >
      {feedback === "none" ? (
        children
      ) : (
        <Animated.View pointerEvents="none" style={[style, visualStyle]}>
          {children}
        </Animated.View>
      )}
    </Touchable>
  );
}
