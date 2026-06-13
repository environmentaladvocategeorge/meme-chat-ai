// PersonaAvatar
//
// The circular avatar for a resolved persona, shared by the chat header pill
// and the persona picker. The default persona uses the app's bot art
// (AgentAvatar); user personas have no art pipeline yet, so they render a
// monogram disc keyed off the first letter of their name — a stable
// placeholder until avatarKey-backed art exists.

import { AgentAvatar } from "@/components/AgentAvatar";
import { Typography } from "@/components/Typography";
import type { ResolvedPersona } from "@/domain/personas";
import { useTheme } from "@/hooks/useTheme";
import { View } from "react-native";

export function PersonaAvatar({
  persona,
  size,
}: {
  persona: ResolvedPersona;
  size: number;
}) {
  const theme = useTheme();
  if (persona.kind === "default") return <AgentAvatar size={size} />;

  const ch = persona.persona.displayName.trim().charAt(0);
  const letter = ch ? ch.toUpperCase() : "?";
  return (
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
  );
}
