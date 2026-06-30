// Boot-time placeholder for the composer cluster — shown while entitlement
// state is still loading (chat.tsx renders neither the composer nor the
// upgrade block until it knows which one applies).
//
// Mirrors the real layout's geometry — the input pill (PILL_RADIUS * 2 tall) and
// the accessory chip row (camera circle + the content-sized Media + Rot pills,
// packed left) — so when the real composer mounts it lands close to the
// skeleton's shapes and the swap reads as "the UI filled in," not "a loader was
// replaced."
//
// All shapes share ONE loop (a single `progress`) so the row breathes in unison.

import { PILL_RADIUS } from "@/components/ChatInput";
import { COMPOSER_CHIP_HEIGHT } from "@/components/chat/ComposerToggles";
import { Shimmer, SHIMMER_DURATION } from "@/components/Shimmer";
import { useEffect } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import {
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

export function ComposerSkeleton() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: SHIMMER_DURATION,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      false,
    );
  }, [progress]);

  // Content-sized lozenges (the real chips no longer stretch). Approximate
  // widths for the camera circle, the "Media" pill, and the wider "Rot Level"
  // pill (label + intensity meter).
  const chip = (width: number): StyleProp<ViewStyle> => ({
    height: COMPOSER_CHIP_HEIGHT,
    borderRadius: COMPOSER_CHIP_HEIGHT / 2,
    width,
  });

  return (
    // Pure placeholder — hidden from assistive tech so a screen reader never
    // lands on empty shapes (the thread's loader already announces loading).
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Composer pill at its resting (single-line) height. */}
      <Shimmer
        progress={progress}
        style={{ height: PILL_RADIUS * 2, borderRadius: PILL_RADIUS }}
      />
      {/* Accessory row: camera circle + the Media and Rot pills, packed left. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginTop: 8,
        }}
      >
        <Shimmer progress={progress} style={chip(COMPOSER_CHIP_HEIGHT)} />
        <Shimmer progress={progress} style={chip(104)} />
        <Shimmer progress={progress} style={chip(120)} />
      </View>
    </View>
  );
}
