// Replacement for RN's KeyboardAvoidingView on the chat screen (iOS; plain
// View on Android, matching how the screen used the stock component). Two
// deliberate differences from stock:
//
// 1. It cannot get stuck after a background/foreground cycle. Stock KAV
//    stores the last keyboardWillShow event and offsets the view until a
//    keyboardWillHide arrives — but iOS doesn't reliably deliver that hide
//    to JS when the app is backgrounded with the keyboard up, and can fire
//    a spurious willShow during foreground restoration. The stale offset
//    then squishes the whole chat to the top until the next real keyboard
//    cycle (stock only self-corrects at MOUNT via Keyboard.isVisible()).
//    This version re-validates against Keyboard.isVisible() every time the
//    app returns to the foreground — immediately, and again after a short
//    settle window so a late restoration willShow can't sneak back in.
//
// 2. It avoids the keyboard by SHRINKING ITS HEIGHT (stock's "height"
//    behavior), not by paddingBottom. RN positions `position: "absolute"`
//    children relative to the parent's border box, IGNORING padding — so a
//    padding-based avoider lifts the in-flow message list but leaves the
//    absolutely-anchored composer dock (bottom: 0) pinned behind the
//    keyboard. A shorter container moves its bottom edge — and the dock
//    anchored to it — above the keyboard.

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  AppState,
  Dimensions,
  Keyboard,
  type KeyboardEvent,
  type LayoutChangeEvent,
  LayoutAnimation,
  Platform,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";

// How long after foregrounding to re-check for a stale pad. Restoration
// keyboard events land within the first frames; 250ms is comfortably past
// them without a visible delay if a correction is needed.
const FOREGROUND_SETTLE_MS = 250;

export function AppKeyboardAvoidingView({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const [bottom, setBottom] = useState(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The container's natural (keyboard-closed) height, measured via onLayout.
  // Needed to compute the shrunken height; only recorded while the keyboard
  // is down so the shrunken layout never overwrites the resting one.
  const restingHeight = useRef(0);
  const bottomRef = useRef(0);
  bottomRef.current = bottom;

  const handleLayout = (e: LayoutChangeEvent) => {
    if (bottomRef.current === 0) {
      restingHeight.current = e.nativeEvent.layout.height;
    }
  };

  useEffect(() => {
    // Android relies on the window resizing (adjustResize) — same as the
    // stock component with `behavior` undefined. iOS-only from here.
    if (Platform.OS !== "ios") return;

    // Mirror stock KAV: ride the keyboard's own animation curve so the
    // composer moves in lockstep with the keyboard instead of lagging it.
    const animate = (e: KeyboardEvent) => {
      if (e.duration > 10) {
        LayoutAnimation.configureNext({
          duration: e.duration,
          update: {
            duration: e.duration,
            type:
              LayoutAnimation.Types[
                e.easing as keyof typeof LayoutAnimation.Types
              ] ?? LayoutAnimation.Types.keyboard,
          },
        });
      }
    };

    const onShow = (e: KeyboardEvent) => {
      // The screen-filling view's bottom edge is the window bottom, so the
      // overlap with the keyboard is simply window height − keyboard top.
      const next = Math.max(
        0,
        Dimensions.get("window").height - e.endCoordinates.screenY,
      );
      animate(e);
      setBottom(next);
    };

    const onHide = (e: KeyboardEvent) => {
      animate(e);
      setBottom(0);
    };

    // The fix: Keyboard.isVisible() tracks did-show/did-hide and reflects
    // whether a keyboard is ACTUALLY on screen — if it isn't, any pad we're
    // holding is stale.
    const resetIfKeyboardGone = () => {
      if (!Keyboard.isVisible()) setBottom(0);
    };

    const subs = [
      Keyboard.addListener("keyboardWillShow", onShow),
      Keyboard.addListener("keyboardWillHide", onHide),
      AppState.addEventListener("change", (state) => {
        if (state !== "active") return;
        resetIfKeyboardGone();
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
          settleTimer.current = null;
          resetIfKeyboardGone();
        }, FOREGROUND_SETTLE_MS);
      }),
    ];

    return () => {
      subs.forEach((s) => s.remove());
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  // Height behavior: shrink the container so its bottom edge (and the
  // absolutely-anchored dock riding it) sits on top of the keyboard. flex: 0
  // must accompany the explicit height or flex re-stretches the view.
  const avoidStyle =
    bottom > 0 && restingHeight.current > 0
      ? { height: restingHeight.current - bottom, flex: 0 }
      : null;

  return (
    <View style={[style, avoidStyle]} onLayout={handleLayout}>
      {children}
    </View>
  );
}
