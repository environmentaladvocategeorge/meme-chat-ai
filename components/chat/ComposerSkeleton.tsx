// Boot-time placeholder for the composer cluster — shown while entitlement
// state is still loading (chat.tsx renders neither the composer nor the
// upgrade block until it knows which one applies).
//
// Mirrors the real layout's exact geometry — the input pill (PILL_RADIUS * 2
// tall) and the accessory chip row (circle + three lozenges) — so when the
// real composer mounts it lands pixel-for-pixel on the skeleton's shapes and
// the swap reads as "the UI filled in," not "a loader was replaced."
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

  const chip = (flex: boolean): StyleProp<ViewStyle> => ({
    height: COMPOSER_CHIP_HEIGHT,
    borderRadius: COMPOSER_CHIP_HEIGHT / 2,
    ...(flex ? { flex: 1 } : { width: COMPOSER_CHIP_HEIGHT }),
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
      {/* Accessory row: camera circle + three flexible chips. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginTop: 8,
        }}
      >
        <Shimmer progress={progress} style={chip(false)} />
        <Shimmer progress={progress} style={chip(true)} />
        <Shimmer progress={progress} style={chip(true)} />
        <Shimmer progress={progress} style={chip(true)} />
      </View>
    </View>
  );
}
