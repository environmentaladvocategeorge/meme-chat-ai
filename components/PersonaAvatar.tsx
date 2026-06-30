// PersonaAvatar
//
// The circular avatar for a resolved persona, shared by the chat header pill
// and the persona picker. The default persona uses the app's bot art
// (AgentAvatar); a user persona shows its uploaded image (publicConfig
// avatarUrl) when it has one, otherwise a monogram disc keyed off the first
// letter of its name.
//
// `float` adds the slow idle bob used by the empty-chat hero, so the selected
// persona — default or user-built — animates the same way. For the default it
// rides AgentAvatar's float; for a user persona we apply the matching bob here
// (BotAvatar only floats a static require()'d asset, not a remote image).

import { AgentAvatar } from "@/components/AgentAvatar";
import { Typography } from "@/components/Typography";
import type { ResolvedPersona } from "@/domain/personas";
import { useTheme } from "@/hooks/useTheme";
import { Image } from "expo-image";
import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

// Bundled avatar art for curated first-party bots, keyed by their avatarKey
// (domain/personas FIRST_PARTY_PERSONAS). A key with no mapped asset falls
// through to the monogram, so a new first-party bot can ship before its art does.
const FIRST_PARTY_AVATARS: Record<string, number> = {
  luna: require("../assets/images/luna-avatar.png"),
};

export function PersonaAvatar({
  persona,
  size,
  float = false,
}: {
  persona: ResolvedPersona;
  size: number;
  float?: boolean;
}) {
  const theme = useTheme();
  if (persona.kind === "default") return <AgentAvatar size={size} float={float} />;

  // First-party bots (e.g. Luna) render their bundled app asset, with the same
  // soft bob as a user persona. Falls through to avatarUrl/monogram if unmapped.
  const bundled =
    persona.kind === "firstParty" && persona.persona.avatarKey
      ? FIRST_PARTY_AVATARS[persona.persona.avatarKey]
      : undefined;
  if (bundled) {
    return (
      <Floaty size={size} float={float}>
        <Image
          source={bundled}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: theme["--color-card-muted"],
          }}
          contentFit="cover"
        />
      </Floaty>
    );
  }

  if (persona.persona.avatarUrl) {
    return (
      <Floaty size={size} float={float}>
        <Image
          source={{ uri: persona.persona.avatarUrl }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: theme["--color-card-muted"],
          }}
          contentFit="cover"
        />
      </Floaty>
    );
  }

  const ch = persona.persona.displayName.trim().charAt(0);
  const letter = ch ? ch.toUpperCase() : "?";
  return (
    <Floaty size={size} float={float}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme["--color-card-muted"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      >
        <Typography
          variant="title-md"
          style={{ color: theme["--color-foreground"], fontSize: size * 0.42 }}
        >
          {letter}
        </Typography>
      </View>
    </Floaty>
  );
}

// The slow vertical bob, matching BotAvatar's "float" motion exactly so a user
// persona idles identically to the default bot. A no-op passthrough when
// float is off (the common case — header pill, picker rows).
function Floaty({
  size,
  float,
  children,
}: {
  size: number;
  float: boolean;
  children: ReactNode;
}) {
  const bob = useSharedValue(0);
  useEffect(() => {
    if (!float) return;
    bob.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [float, bob]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -size * 0.06 * bob.value }],
  }));

  if (!float) return <>{children}</>;
  return <Animated.View style={style}>{children}</Animated.View>;
}
