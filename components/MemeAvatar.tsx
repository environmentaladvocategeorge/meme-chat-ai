// MemeAvatar
//
// Circular avatar for the expressive Me-Me "face" art (sunglasses / worried
// speech-bubble). Same circular framing + optional brand-glow pulse as
// AgentAvatar, but driven by a named variant so screens can pick the mood:
//   - "cool"    → plan & usage page hero ("level up your meme-power")
//   - "worried" → out-of-meme-power quota modal
//
// The source PNGs already ship a purple→pink gradient backdrop that matches
// the brand, so the circle just clips them.

import { gradients } from "@/nativewind-theme";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

export type MemeAvatarVariant = "cool" | "worried" | "loading";

// Metro resolves these static requires to numeric asset ids.
const SOURCES: Record<MemeAvatarVariant, number> = {
  cool: require("../assets/images/meme-level-up.png"),
  worried: require("../assets/images/meme-out-of-power.png"),
  loading: require("../assets/images/meme-loading.png"),
};

interface MemeAvatarProps {
  variant: MemeAvatarVariant;
  size?: number;
  pulse?: boolean;
}

export function MemeAvatar({ variant, size = 64, pulse = false }: MemeAvatarProps) {
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;
  const progress = useSharedValue(0);

  useEffect(() => {
    if (pulse) {
      progress.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      progress.value = withTiming(0, { duration: 200 });
    }
  }, [pulse, progress]);

  const ringStyle = useAnimatedStyle(() => {
    const o = progress.value;
    return {
      opacity: o * 0.5,
      transform: [{ scale: 1 + o * 0.16 }],
    };
  });

  const avatarStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 0.03 }],
  }));

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
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: "hidden",
          },
          ringStyle,
        ]}
      >
        <LinearGradient
          colors={gradient.colors}
          start={gradient.start}
          end={gradient.end}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: "hidden",
            backgroundColor: "#FFFFFF",
          },
          avatarStyle,
        ]}
      >
        <Image
          source={SOURCES[variant]}
          style={{ width: size, height: size }}
          resizeMode="cover"
        />
      </Animated.View>
    </View>
  );
}
