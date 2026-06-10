import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

// Page-level bubble gradient
//
// Telegram-style trick: rather than painting a full gradient inside every
// user bubble (which makes each bubble look identical), we draw ONE gradient
// that spans the whole screen and let each bubble act as a window onto it.
// Every user bubble renders a screen-tall gradient translated by its own
// on-screen Y, so a bubble near the top reveals the top of the gradient and a
// bubble near the bottom reveals the bottom — masked to the bubble by its
// `overflow: hidden`. A shared scroll offset keeps the gradient pinned to the
// viewport as bubbles slide past, so the thread reads as a single continuous
// sweep painted down the page.
export type BubbleGradientValue = {
  // Live content offset of the message list (driven on the UI thread).
  scrollY: SharedValue<number>;
  // Bumped whenever bubbles may have shifted on screen (content resize,
  // momentum settle) so each bubble re-measures its anchor. A SharedValue —
  // not React state — so a tick re-renders nothing; bubbles react to it via
  // useAnimatedReaction and re-measure off the render path.
  measureTick: SharedValue<number>;
};

// Gate for content-size-driven ticks: while a reply is streaming the content
// height changes on every delta flush (~10×/sec), and re-measuring every
// gradient bubble that often is pure waste — nothing the user can see moves
// until the stream settles. The screen fires one bump on the
// streaming → idle/error transition instead.
export function shouldBumpOnContentSizeChange(
  status: "idle" | "streaming" | "error",
): boolean {
  return status !== "streaming";
}

export const BubbleGradientContext = createContext<BubbleGradientValue | null>(
  null,
);
export const useBubbleGradient = () => useContext(BubbleGradientContext);

// The list is `inverted`, so a bubble's on-screen Y *increases* as the content
// offset grows (scrolling toward older messages pushes existing bubbles down).
// Flip to -1 if the gradient ever drifts the wrong way during a scroll.
export const SCROLL_SIGN = 1;
