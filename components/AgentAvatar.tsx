// AgentAvatar
//
// Circular avatar for the Brainrot Bot agent, using the app icon. Motion modes:
//   - `pulse` → the shared "thinking" loader (wobble + orbiting spark), for
//     streaming replies / loading states.
//   - `float` → a slow vertical bob (idle hero, e.g. the empty-chat prompt
//     screen), matching the landing page.
// With neither it's a static circle. `float` wins if both are set.

import { BotAvatar } from "@/components/BotAvatar";

interface AgentAvatarProps {
  size?: number;
  pulse?: boolean;
  float?: boolean;
}

export function AgentAvatar({ size = 28, pulse = false, float = false }: AgentAvatarProps) {
  return (
    <BotAvatar
      size={size}
      source={require("../assets/images/app-icon.png")}
      motion={float ? "float" : pulse ? "think" : "none"}
    />
  );
}
