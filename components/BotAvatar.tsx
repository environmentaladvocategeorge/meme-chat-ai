// BotAvatar
//
// The one circular bot-avatar primitive. Renders the bot art in a circle and
// animates it per `motion`:
//   - "none"  → static.
//   - "think" → squash-stretch wobble + an amber spark orbiting with a comet
//               trail. The shared "bot is thinking" loader (NOT the generic
//               breathing pulse), used wherever a reply is streaming / loading.
//   - "float" → a slow vertical bob, the same "floaty" feel as the landing hero.
//
// Both think and float avoid scaling the avatar bitmap on its own axis in a way
// that resamples it ugly: float is pure translate, and think's squash is tiny
// and intentional. Consumed by AgentAvatar (app icon) and MemeAvatar (face art)
// so motion stays identical everywhere.

import { gradients } from "@/nativewind-theme";
import { Image } from "expo-image";
import { useColorScheme } from "nativewind";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

export type BotMotion = "none" | "think" | "float";

// Charcoal matching the bot icon art's background (~rgb(7,8,10)). Sits behind
// the circular avatar so the rounded-clip antialiasing seam never flashes a
// white edge against the dark icon (the old "#FFFFFF" backing did, top/bottom).
const ICON_BG = "#07080A";

// The orbiting comet trail: three dots at decreasing size/opacity, each set back
// a few degrees so the cluster reads as one spark with a tail.
const TRAIL = [
  { lag: 0, scale: 1, opacity: 1 },
  { lag: 16, scale: 0.78, opacity: 0.5 },
  { lag: 32, scale: 0.58, opacity: 0.24 },
];

interface BotAvatarProps {
  size: number;
  // Metro-resolved static asset id (require("...")).
  source: number;
  motion: BotMotion;
}

export function BotAvatar({ size, source, motion }: BotAvatarProps) {
  const { colorScheme } = useColorScheme();
  const sparkColor = gradients[colorScheme ?? "light"].accent.colors[0];

  // `spin` + `wobble` drive the thinking loader; `bob` the float. All run as
  // continuous phases so motion is seamless (wobble read through Math.sin).
  const spin = useSharedValue(0);
  const wobble = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    if (motion === "think") {
      spin.value = withRepeat(
        withTiming(1, { duration: 1300, easing: Easing.linear }),
        -1,
        false,
      );
      wobble.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.linear }),
        -1,
        false,
      );
      bob.value = withTiming(0, { duration: 200 });
    } else if (motion === "float") {
      bob.value = withRepeat(
        withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
      spin.value = 0;
      wobble.value = withTiming(0, { duration: 200 });
    } else {
      spin.value = 0;
      wobble.value = withTiming(0, { duration: 200 });
      bob.value = withTiming(0, { duration: 200 });
    }
  }, [motion, spin, wobble, bob]);

  const avatarStyle = useAnimatedStyle(() => {
    const s = Math.sin(wobble.value * Math.PI * 2); // -1 → 1, seamless
    return {
      transform: [
        { translateY: -size * 0.06 * bob.value },
        { rotate: `${s * 5}deg` },
        { scaleX: 1 + s * 0.045 },
        { scaleY: 1 - s * 0.045 },
      ],
    };
  });

  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  // The spark orbits just outside the avatar rim; the box is grown by the dot
  // size so the trail clears the face.
  const dot = Math.max(6, size * 0.13);
  const orbitBox = size + dot * 1.8;

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {motion === "think" ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: orbitBox,
              height: orbitBox,
              left: (size - orbitBox) / 2,
              top: (size - orbitBox) / 2,
            },
            orbitStyle,
          ]}
        >
          {TRAIL.map((t, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={{
                position: "absolute",
                width: orbitBox,
                height: orbitBox,
                alignItems: "center",
                transform: [{ rotate: `-${t.lag}deg` }],
              }}
            >
              <View
                style={{
                  width: dot * t.scale,
                  height: dot * t.scale,
                  borderRadius: dot,
                  backgroundColor: sparkColor,
                  opacity: t.opacity,
                  // Glow only the lead dot so the trail reads as a fading tail.
                  shadowColor: sparkColor,
                  shadowOpacity: i === 0 ? 0.7 : 0,
                  shadowRadius: dot * 0.6,
                  shadowOffset: { width: 0, height: 0 },
                }}
              />
            </View>
          ))}
        </Animated.View>
      ) : null}

      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: "hidden",
            backgroundColor: ICON_BG,
          },
          avatarStyle,
        ]}
      >
        <Image
          source={source}
          style={{ width: size, height: size }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
      </Animated.View>
    </View>
  );
}
