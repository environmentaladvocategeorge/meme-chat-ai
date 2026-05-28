// AgentAvatar
//
// Circular avatar for the Me-Me agent, using the app icon. Has an optional
// `pulse` mode that runs a gentle continuous scale + ring-glow animation
// — used while a reply is being streamed to signal "the agent is thinking."
// When `pulse` is false it's a static circle.

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

interface AgentAvatarProps {
  size?: number;
  pulse?: boolean;
}

export function AgentAvatar({ size = 28, pulse = false }: AgentAvatarProps) {
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;
  const progress = useSharedValue(0);

  useEffect(() => {
    if (pulse) {
      progress.value = withRepeat(
        withTiming(1, {
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        true,
      );
    } else {
      progress.value = withTiming(0, { duration: 200 });
    }
  }, [pulse, progress]);

  const ringStyle = useAnimatedStyle(() => {
    // The pulse halo. When `pulse` is on, opacity breathes between ~0.0
    // and ~0.6 and a soft outer glow scales slightly. When off, hidden.
    const o = progress.value;
    return {
      opacity: o * 0.55,
      transform: [{ scale: 1 + o * 0.18 }],
    };
  });

  const avatarStyle = useAnimatedStyle(() => {
    // The avatar itself gets a subtler scale pulse so it feels alive
    // without bouncing.
    const o = progress.value;
    return {
      transform: [{ scale: 1 + o * 0.04 }],
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
      {/* Soft brand-tinted glow ring, only visible during pulse. */}
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
          source={require("../assets/images/app-icon.png")}
          style={{ width: size, height: size }}
          resizeMode="cover"
        />
      </Animated.View>
    </View>
  );
}
