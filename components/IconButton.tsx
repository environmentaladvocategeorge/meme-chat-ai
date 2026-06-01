// Fixed-size icon affordance (camera, new-chat, header back, close, send…),
// built on AppPressable so it inherits the static-target + inner-feedback
// discipline that keeps small targets reliable on Fabric release builds.
//
// The hit target is a fixed square `size`×`size`; the visible circle/surface
// lives on the inner animated view and is what scales on press. A generous
// default hitSlop forgives the edges of these small targets — the thing that
// was actually dropping taps.

import { AppPressable } from "@/components/AppPressable";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export interface IconButtonProps {
  onPress: () => void;
  children: ReactNode;
  accessibilityLabel: string;
  // Square hit-target edge. Surface fills it unless surfaceStyle overrides.
  size?: number;
  // Surface look — backgroundColor / borderWidth / borderColor / borderRadius.
  // Defaults to a fully-rounded circle of `size`.
  surfaceStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  // Shows a spinner instead of children and disables the press.
  busy?: boolean;
  busyColor?: string;
  haptic?: boolean;
  // Number for an even cushion, or an inset object to trim a specific edge
  // (e.g. a button packed tight against a neighbour).
  hitSlop?: PressableProps["hitSlop"];
  accessibilityState?: { expanded?: boolean; selected?: boolean };
}

export function IconButton({
  onPress,
  children,
  accessibilityLabel,
  size = 44,
  surfaceStyle,
  disabled = false,
  busy = false,
  busyColor,
  haptic = true,
  hitSlop = 12,
  accessibilityState,
}: IconButtonProps) {
  return (
    <AppPressable
      onPress={onPress}
      disabled={disabled || busy}
      haptic={haptic}
      hitSlop={hitSlop}
      pressScale={0.08}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={
        busy ? { ...accessibilityState, disabled: true } : accessibilityState
      }
      containerStyle={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
        },
        surfaceStyle,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={busyColor} /> : children}
    </AppPressable>
  );
}
