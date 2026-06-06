// MemeAvatar
//
// Circular avatar for the expressive Brainrot Bot "face" art. Picks a mood by
// variant:
//   - "cool"    → sunglasses bot; plan & usage hero, onboarding reveal
//   - "worried" → sad bot; out-of-power quota modal, failed turns, usage notices
//   - "loading" → wink bot; "thinking" indicator while a reply streams
//
// Motion (gated by `pulse`): the "loading" variant uses the shared think loader
// (wobble + orbiting spark); cool/worried use a slow vertical bob — the same
// floaty feel as the landing hero. All handled by BotAvatar.

import { BotAvatar, type BotMotion } from "@/components/BotAvatar";

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
  const motion: BotMotion = !pulse
    ? "none"
    : variant === "loading"
      ? "think"
      : "float";

  return <BotAvatar size={size} source={SOURCES[variant]} motion={motion} />;
}
