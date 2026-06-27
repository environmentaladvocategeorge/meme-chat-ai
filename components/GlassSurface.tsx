// GlassSurface
//
// Shared wrapper for the app's input/search bars: renders the native
// iOS 26 Liquid Glass material (expo-glass-effect) when the platform
// supports it, and falls back to the surface's previous solid styling
// everywhere else (Android, iOS < 26).
//
// Why a wrapper instead of using GlassView directly:
//   - GlassView must not be given a backgroundColor or border — they paint
//     over the material and kill the effect. Solid backgrounds/borders
//     therefore live in `fallbackStyle`, applied only on the non-glass path.
//   - Availability is constant for the process lifetime, so it's read once
//     at module scope and exported for callers that need to branch.
//
// ⚠️ OPACITY-0 TRAP (expo-glass-effect known issue): if a GlassView — or ANY
// parent view — is ever set to opacity 0, the native glass stops rendering and
// stays blank, even after opacity returns to 1. So NEVER fade a glass element
// (or an ancestor) through opacity 0. Instead:
//   - fade in/out via a non-opacity transform (scale / translateX/Y), or
//   - floor the hidden state at a tiny non-zero opacity (~0.02, still invisible
//     but keeps the material alive), or
//   - toggle glassEffectStyle to 'none' while hidden (see Expo docs).
// Every reanimated `opacity`/`FadeIn`/`FadeOut`/`entering` on a glass subtree is
// suspect — this caused the "randomly no background" glass bugs.

import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ComponentProps, ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedProps,
  type SharedValue,
} from "react-native-reanimated";

export const liquidGlassAvailable = isLiquidGlassAvailable();

// Animated variant so glassEffectStyle can be driven on the UI thread — the
// Expo-sanctioned way to fade glass in/out (see fadeProgress below).
const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);

// Below this, the glass switches to 'none' so an opacity-0 ancestor can't blank
// the material. Matches Expo's opacity-workaround threshold.
const FADE_GLASS_THRESHOLD = 0.02;

type GlassSurfaceProps = Omit<ComponentProps<typeof View>, "style"> & {
  // Shared layout styling (size, radius, padding, flex). Applied on both paths.
  style?: StyleProp<ViewStyle>;
  // Applied only when glass is unavailable — solid background, border, etc.
  fallbackStyle?: StyleProp<ViewStyle>;
  // "regular" adapts its contrast to the content behind it; "clear" is more
  // transparent. Regular is the right default for surfaces holding text.
  glassEffectStyle?: "regular" | "clear";
  tintColor?: string;
  // Optional fade driver (a 0→1 SharedValue). Pass this when the surface — or
  // any ancestor — is faded via opacity: the native glass blanks permanently if
  // it ever sits at opacity 0 (expo-glass-effect known issue), so instead of
  // relying on opacity alone we flip glassEffectStyle to 'none' near 0. The
  // CALLER still animates the wrapper opacity from the SAME SharedValue; this
  // just keeps the material alive across the fade. See the opacity-0 note above.
  fadeProgress?: SharedValue<number>;
  children?: ReactNode;
};

export function GlassSurface({
  style,
  fallbackStyle,
  glassEffectStyle = "regular",
  tintColor,
  fadeProgress,
  children,
  ...rest
}: GlassSurfaceProps) {
  // Hook runs unconditionally (rules of hooks); only consulted on the animated
  // path below. When no fadeProgress, it just echoes the static style.
  const animatedProps = useAnimatedProps(() => ({
    glassEffectStyle:
      fadeProgress && fadeProgress.value <= FADE_GLASS_THRESHOLD
        ? ("none" as const)
        : glassEffectStyle,
  }));

  if (liquidGlassAvailable) {
    // Only the fading surfaces pay for the animated component; everything else
    // stays on the plain GlassView (no behavior change).
    if (fadeProgress) {
      return (
        <AnimatedGlassView
          tintColor={tintColor}
          style={style}
          animatedProps={animatedProps}
          {...rest}
        >
          {children}
        </AnimatedGlassView>
      );
    }
    return (
      <GlassView
        glassEffectStyle={glassEffectStyle}
        tintColor={tintColor}
        style={style}
        {...rest}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[style, fallbackStyle]} {...rest}>
      {children}
    </View>
  );
}
