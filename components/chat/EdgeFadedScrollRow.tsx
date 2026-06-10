// Horizontal scroll row with a soft fade at the trailing edge — the quiet
// hint that more chips exist offscreen (narrow screens / long locales).
// Used by the composer accessory row in chat.tsx.
//
// The fade is a small gradient from transparent to `fadeColor`, shown only
// while there is actually content hidden to the right: it tracks layout,
// content width, and scroll position on the UI thread and eases out as the
// user reaches the end. Pass `fadeColor: null` to disable the overlay
// entirely — the chat backdrop can be a user-chosen gradient, where no
// single color can match the pixels under the fade.
import { withAlpha } from "@/domain/customization";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const FADE_WIDTH = 28;

export function EdgeFadedScrollRow({
  fadeColor,
  style,
  contentContainerStyle,
  children,
}: {
  // Solid backdrop color behind the row, or null to render no fade.
  fadeColor: string | null;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const layoutWidth = useSharedValue(0);
  const contentWidth = useSharedValue(0);
  const scrollX = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const fadeStyle = useAnimatedStyle(() => {
    const maxScroll = contentWidth.value - layoutWidth.value;
    // +4 / -8: small tolerances so subpixel layout jitter near the end
    // doesn't flicker the fade.
    const show = maxScroll > 4 && scrollX.value < maxScroll - 8;
    return { opacity: withTiming(show ? 1 : 0, { duration: 160 }) };
  });

  return (
    <View style={[style, { position: "relative" }]}>
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onLayout={(e) => {
          layoutWidth.value = e.nativeEvent.layout.width;
        }}
        onContentSizeChange={(w) => {
          contentWidth.value = w;
        }}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </Animated.ScrollView>
      {fadeColor !== null ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              right: 0,
              width: FADE_WIDTH,
            },
            fadeStyle,
          ]}
        >
          <LinearGradient
            // Alpha-zero of the SAME color, not "transparent": the literal
            // keyword is rgba(0,0,0,0), which fringes gray mid-fade on iOS.
            colors={[withAlpha(fadeColor, 0), fadeColor]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
