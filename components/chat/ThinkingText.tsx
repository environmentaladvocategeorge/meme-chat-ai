import { useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

// A soft highlight band sweeps left→right across the label on a loop. Each
// glyph warms from the muted base color up into the brand gradient (and lifts
// a hair) as the band passes over it, giving "Memeing…" a gentle, playful
// shimmer instead of dead static text. Built on Animated.Text directly because
// Reanimated needs a ref-forwarding host to push animated style updates to
// native — our Typography wrapper doesn't forward refs.
const SHIMMER_DURATION_MS = 1600;
const SHIMMER_BAND = 0.42; // fraction of the sweep that's "lit" at once
const SHIMMER_LIFT = 2; // px the brightest glyph rises

// Linear interpolate between two #RRGGBB hex colors on the JS thread, so each
// glyph's target brand hue is precomputed and the worklet only fades between
// the muted base and that target.
function lerpHex(a: string, b: string, t: number): string {
  const ai = parseInt(a.slice(1), 16);
  const bi = parseInt(b.slice(1), 16);
  const ar = (ai >> 16) & 255;
  const ag = (ai >> 8) & 255;
  const ab = ai & 255;
  const br = (bi >> 16) & 255;
  const bg = (bi >> 8) & 255;
  const bb = bi & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

function ShimmerChar({
  char,
  position,
  progress,
  baseColor,
  brightColor,
}: {
  char: string;
  position: number; // 0..1 across the label
  progress: SharedValue<number>;
  baseColor: string;
  brightColor: string;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    // Distance from the sweeping head, wrapped onto [-0.5, 0.5] so the band
    // re-enters seamlessly from the left each loop.
    let d = (((position - progress.value) % 1) + 1) % 1;
    if (d > 0.5) d -= 1;
    const closeness = Math.max(0, 1 - Math.abs(d) / SHIMMER_BAND);
    // smoothstep for a soft falloff at the band edges
    const eased = closeness * closeness * (3 - 2 * closeness);
    return {
      color: interpolateColor(eased, [0, 1], [baseColor, brightColor]),
      opacity: 0.5 + 0.5 * eased,
      transform: [{ translateY: -SHIMMER_LIFT * eased }],
    };
  });

  return (
    <Animated.Text
      style={[
        {
          fontFamily: "Poppins-Medium",
          fontSize: 14,
          lineHeight: 21,
          includeFontPadding: false,
          textAlignVertical: "center",
        },
        animatedStyle,
      ]}
    >
      {char}
    </Animated.Text>
  );
}

export function ThinkingText({
  label,
  baseColor,
  gradient,
}: {
  label: string;
  baseColor: string;
  gradient: readonly string[];
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: SHIMMER_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false,
    );
  }, [progress]);

  const chars = useMemo(() => Array.from(label), [label]);
  const from = gradient[0] ?? baseColor;
  const to = gradient[gradient.length - 1] ?? from;

  return (
    <View style={{ flexDirection: "row", paddingTop: SHIMMER_LIFT }}>
      {chars.map((c, i) => (
        <ShimmerChar
          key={`${c}-${i}`}
          char={c}
          position={chars.length > 1 ? i / (chars.length - 1) : 0}
          progress={progress}
          baseColor={baseColor}
          // Spread the brand sweep across the glyphs so the lit band itself
          // reads as a gradient, not a single flat highlight color.
          brightColor={lerpHex(
            from,
            to,
            chars.length > 1 ? i / (chars.length - 1) : 0,
          )}
        />
      ))}
    </View>
  );
}
