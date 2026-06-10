// BotAvatar
//
// The one circular bot-avatar primitive. Renders the bot art in a circle and
// animates it per `motion`:
//   - "none"  → static.
//   - "think" → a looping "thinking hop": crouch, a small jelly hop with
//               squash & stretch, land, settle, rest. The shared "bot is
//               thinking" loader, used wherever a reply is streaming /
//               loading. Deliberately no rotation, no orbiting elements and
//               no radiating pulse — earlier versions of those read as
//               annoying or generic.
//   - "float" → a slow vertical bob, the same "floaty" feel as the landing hero.
//
// Both think and float avoid resampling the avatar bitmap ugly: float is pure
// translate, and the hop's squash is small and brief. Consumed by AgentAvatar
// (app icon) and MemeAvatar (face art) so motion stays identical everywhere.

import { Image } from "expo-image";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  interpolate,
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

// One full hop cycle. The hop itself lives in the first ~60% of the phase;
// the remainder is a rest beat so the motion reads as a creature idling, not
// a metronome.
const HOP_MS = 1400;

interface BotAvatarProps {
  size: number;
  // Metro-resolved static asset id (require("...")).
  source: number;
  motion: BotMotion;
}

export function BotAvatar({ size, source, motion }: BotAvatarProps) {
  // `hop` drives the thinking loop; `bob` the float. Each runs as a single
  // continuous 0→1 phase so the loop is seamless (keyframes start and end
  // neutral) and a restart can never catch a stale mid-cycle value.
  const hop = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    if (motion === "think") {
      hop.value = 0;
      hop.value = withRepeat(
        withTiming(1, { duration: HOP_MS, easing: Easing.linear }),
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
      hop.value = withTiming(0, { duration: 200 });
    } else {
      hop.value = withTiming(0, { duration: 200 });
      bob.value = withTiming(0, { duration: 200 });
    }
  }, [motion, hop, bob]);

  const avatarStyle = useAnimatedStyle(() => {
    const p = hop.value;
    // Keyframes over the linear phase: crouch (anticipation squash) → hop up
    // with stretch → fall → landing squash → jelly settle → rest. Timing
    // character comes from the keyframe spacing, so the phase itself stays
    // linear and loop-seamless.
    const translateY = interpolate(
      p,
      [0, 0.1, 0.3, 0.46, 1],
      [0, size * 0.02, -size * 0.12, 0, 0],
    );
    const scaleY = interpolate(
      p,
      [0, 0.1, 0.3, 0.46, 0.58, 0.72, 1],
      [1, 0.9, 1.07, 0.92, 1.03, 1, 1],
    );
    const scaleX = interpolate(
      p,
      [0, 0.1, 0.3, 0.46, 0.58, 0.72, 1],
      [1, 1.07, 0.95, 1.06, 0.98, 1, 1],
    );
    return {
      transform: [
        { translateY: translateY - size * 0.06 * bob.value },
        { scaleX },
        { scaleY },
      ],
    };
  });

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: "hidden",
            backgroundColor: ICON_BG,
            // Squash & stretch anchor at the "ground" so the crouch and the
            // landing read as grounded instead of compressing around center.
            transformOrigin: "50% 100%",
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
