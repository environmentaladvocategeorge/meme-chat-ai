import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

// iMessage-style timestamp reveal
//
// A horizontal swipe-left on the thread slides every bubble left in unison,
// exposing each message's timestamp pinned at the right margin; releasing
// springs it back. One shared progress value drives all bubbles so the whole
// thread moves as a single sheet, and — being a SharedValue rather than React
// state — the swipe re-renders nothing. This replaces the old tap-the-bubble
// timestamp toggle, which sat on a Pressable that swallowed the long-press
// gesture and so blocked native text selection inside the bubble.
export type TimeRevealValue = {
  // 0 at rest, 1 at full reveal. Drives each bubble's leftward shift and the
  // timestamp's fade-in.
  progress: SharedValue<number>;
};

export const TimeRevealContext = createContext<TimeRevealValue | null>(null);
export const useTimeReveal = () => useContext(TimeRevealContext);

// How far (px) the thread slides left at full reveal — enough room for a short
// "h:mm AM" stamp in the freed right margin.
export const TIME_REVEAL_WIDTH = 64;
