// SheetBackdrop
//
// Drop-in replacement for gorhom's <BottomSheetBackdrop pressBehavior="close">.
//
// Why this exists: the stock backdrop flips its own `pointerEvents` from
// "auto" to "none" through a `runOnJS` → React setState round-trip when the
// sheet's animated index crosses below 0 (see BottomSheetBackdrop's
// useAnimatedReaction). On a release/Fabric build that commit lands a frame or
// two AFTER the sheet has visually closed, so the invisible, full-screen
// backdrop keeps capturing for one more tap — the "first tap after closing a
// sheet does nothing" bug. Here `pointerEvents` is derived on the UI thread via
// useAnimatedProps, so the backdrop goes inert the instant the sheet reaches
// its closed index, with no JS lag.

import {
  type BottomSheetBackdropProps,
  useBottomSheet,
} from "@gorhom/bottom-sheet";
import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
} from "react-native-reanimated";

type SheetBackdropProps = BottomSheetBackdropProps & {
  opacity?: number;
  appearsOnIndex?: number;
  disappearsOnIndex?: number;
  // When false the backdrop still dims and blocks touches, but tapping it does
  // not close the sheet (e.g. while an in-sheet action is mid-flight).
  enabled?: boolean;
};

export function SheetBackdrop({
  animatedIndex,
  style,
  opacity = 0.5,
  appearsOnIndex = 0,
  disappearsOnIndex = -1,
  enabled = true,
}: SheetBackdropProps) {
  const { close } = useBottomSheet();

  const containerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      animatedIndex.value,
      [-1, disappearsOnIndex, appearsOnIndex],
      [0, 0, opacity],
      Extrapolation.CLAMP,
    ),
  }));

  // Interactive only while the sheet is open/closing; inert the moment it hits
  // the closed index. Driven on the UI thread — no setState round-trip, so no
  // lingering tap-catcher after the sheet visually closes.
  const animatedProps = useAnimatedProps<{ pointerEvents: "auto" | "none" }>(
    () => ({
      pointerEvents: animatedIndex.value > disappearsOnIndex ? "auto" : "none",
    }),
  );

  const tap = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        runOnJS(close)();
      }),
    [close],
  );

  const view = (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: "#000" },
        style,
        containerStyle,
      ]}
      animatedProps={animatedProps}
    />
  );

  return enabled ? <GestureDetector gesture={tap}>{view}</GestureDetector> : view;
}
