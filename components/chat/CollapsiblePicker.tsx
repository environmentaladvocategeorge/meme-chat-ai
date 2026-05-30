import { type ReactNode } from "react";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

// Shared open/close timing for the bottom-composer surfaces (meme strip, GIF
// drawer, staged tray). Opening is a touch slower than closing so the surface
// feels like a confident push up and a quicker settle back down.
export const COMPOSER_OPEN_MS = 240;
export const COMPOSER_CLOSE_MS = 200;

// CollapsiblePicker
//
// Shows/hides one of the composer surfaces by mounting it when `open` and
// fading it in/out. The content is sized by ordinary layout (the conversation
// above is pushed up by its natural height), so there's no pixel-measurement
// step to get wrong.
//
// A previous version animated its OWN height to `progress × measuredHeight`,
// reading `measuredHeight` from the child's `onLayout`. But that child was
// measured *inside* a container Reanimated was driving to `height: 0` with
// `overflow: hidden`; under the new RN architecture (Fabric) a clipped child
// reports height 0, so the measured value stuck at 0 and the surface never
// opened. Mounting + fade sidesteps that entirely.
//
// Only the surface itself fades — no layout transition is attached to the
// message list or the composer, so the keyboard show/hide stays glued to the
// input (a list/composer layout transition would visibly lag the keyboard).
export function CollapsiblePicker({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(COMPOSER_OPEN_MS)}
      exiting={FadeOut.duration(COMPOSER_CLOSE_MS)}
    >
      {children}
    </Animated.View>
  );
}
