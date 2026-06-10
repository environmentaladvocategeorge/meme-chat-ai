// ChatInput
//
// The chat composer at the bottom of the chat screen.
//
//   - Pill-shaped input with the send button embedded inside on the right.
//     No surrounding card; floats on the screen background.
//   - Grows vertically as the user types — up to four lines — by tracking
//     the TextInput's reported content height. The send button anchors to
//     the bottom of the pill (via `alignItems: "flex-end"`), so text wraps
//     upward while the action target stays fixed.
//   - At the 4-line cap the TextInput starts scrolling internally and a
//     subtle "expand" icon fades in to the left of the send button.
//     Tapping it opens a `BottomSheetModal` with the same draft displayed
//     in a much larger composer surface for longer messages.
//   - Focus state fades in a soft brand-gradient glow ring around the pill.

import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { useChatAccentGradient, useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetTextInput,
  TouchableOpacity as BottomSheetTouchableOpacity,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import {
  ArrowFatUp,
  ArrowsInSimple,
  ArrowsOutSimple,
  Stop,
} from "phosphor-react-native";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const PILL_RADIUS = 26;
const SEND_BUTTON_SIZE = 40;
const EXPAND_HIT_SIZE = 32;
const RING_INSET = 2;
const LINE_HEIGHT = 20;
const TEXT_PADDING_Y = 10;
const MAX_LINES = 4;
// Bounds for the TextInput's outer frame. With min/maxHeight set on the
// TextInput, RN auto-sizes it natively as the user types — no JS-driven
// height update needed, which avoids the iOS "growth only on blur" issue
// (explicit `height` styles batch contentSize callbacks until the next
// layout event). The TextInput auto-scrolls internally once content
// exceeds maxHeight.
const MIN_INPUT_HEIGHT = LINE_HEIGHT + TEXT_PADDING_Y * 2; // 40 — one line
const MAX_INPUT_HEIGHT = LINE_HEIGHT * MAX_LINES + TEXT_PADDING_Y * 2; // 100
const PILL_PADDING_Y = 6;

// Helper style for stacking absolutely-positioned icons in the center of
// their parent — used by the send button's cross-fade icon layers.
const centeredAbsolute = {
  alignItems: "center",
  justifyContent: "center",
} as const;

// Imperative handle so the parent can pull focus back to the composer — used
// when swapping out of the meme picker back to the keyboard.
export type ChatInputRef = {
  focus: () => void;
};

interface ChatInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onCancel: () => void;
  streaming: boolean;
  // When true, send is enabled even with an empty text draft (image-only turn).
  hasAttachments?: boolean;
  // Fired when the composer gains focus. The parent uses this to collapse the
  // meme strip so the keyboard and the picker never share the screen (they
  // occupy the same conceptual slot — see chat.tsx).
  onFocus?: () => void;
  placeholder?: string;
  sendAccessibilityLabel: string;
  cancelAccessibilityLabel: string;
  expandAccessibilityLabel: string;
  collapseAccessibilityLabel: string;
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  function ChatInput(
    {
      value,
      onChangeText,
      onSend,
      onCancel,
      streaming,
      hasAttachments = false,
      onFocus,
      placeholder,
      sendAccessibilityLabel,
      cancelAccessibilityLabel,
      expandAccessibilityLabel,
      collapseAccessibilityLabel,
    },
    ref,
  ) {
  const theme = useTheme();
  const chatAccentGradient = useChatAccentGradient();
  const { colorScheme } = useColorScheme();
  const stockGradient = gradients[colorScheme ?? "light"].primary;
  const gradientColors = chatAccentGradient ?? stockGradient.colors;
  const gradientStart = chatAccentGradient ? { x: 0, y: 0 } : stockGradient.start;
  const gradientEnd = chatAccentGradient ? { x: 1, y: 1 } : stockGradient.end;
  const activeIconColor = theme["--color-primary-foreground"];
  const [focused, setFocused] = useState(false);
  // Overflow detection uses an offscreen "shadow" <Text> with the same
  // font + width as the visible TextInput. `shadowHeight` is that Text's
  // natural rendered height, and `contentWidth` lets us pin the shadow to
  // the same horizontal extent so wrapping matches what the TextInput
  // would do.
  const [shadowHeight, setShadowHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const focusProgress = useSharedValue(0);
  const overflowProgress = useSharedValue(0);
  // Drives the disabled ↔ active cross-fade on the send button — gradient
  // and white icon fade in, muted icon fades out (and vice versa) as the
  // user types or clears the draft, instead of snapping between states.
  const sendActiveProgress = useSharedValue(0);
  // Continuous breathing loop. Multiplied into the focus glow's opacity so
  // the ring gently hovers between ~75% and 100% intensity while focused.
  const pulse = useSharedValue(0);
  const sheetRef = useRef<BottomSheetModal>(null);
  const inputRef = useRef<TextInput>(null);
  const snapPoints = useMemo(() => ["80%"], []);

  useImperativeHandle(
    ref,
    () => ({ focus: () => inputRef.current?.focus() }),
    [],
  );

  const hasContent = value.trim().length > 0;
  // Image-only turns are valid, so attachments alone can enable send.
  const canSend = (hasContent || hasAttachments) && !streaming;
  const showStop = streaming;
  // +1 tolerance for subpixel jitter so a perfectly-4-line draft doesn't
  // false-positive.
  const isOverflowing = shadowHeight > MAX_INPUT_HEIGHT + 1;

  useEffect(() => {
    focusProgress.value = withTiming(focused ? 1 : 0, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
  }, [focused, focusProgress]);

  useEffect(() => {
    overflowProgress.value = withTiming(isOverflowing ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [isOverflowing, overflowProgress]);

  useEffect(() => {
    sendActiveProgress.value = withTiming(canSend ? 1 : 0, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [canSend, sendActiveProgress]);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);

  // Stop-button spinner: a thin arc orbiting the button's perimeter while a
  // reply streams. Runs only during streaming so the worklet isn't looping
  // for the life of the composer.
  const spin = useSharedValue(0);
  useEffect(() => {
    if (streaming) {
      spin.value = 0;
      spin.value = withRepeat(
        withTiming(360, { duration: 900, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(spin);
    }
  }, [streaming, spin]);
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  const ringStyle = useAnimatedStyle(() => {
    // Breathe between 75% and 100% of the focus opacity so the glow has a
    // gentle life of its own instead of sitting completely static.
    const breath = 0.75 + pulse.value * 0.25;
    return { opacity: focusProgress.value * breath };
  });

  const sendActiveStyle = useAnimatedStyle(() => ({
    opacity: sendActiveProgress.value,
  }));
  const sendInactiveStyle = useAnimatedStyle(() => ({
    opacity: 1 - sendActiveProgress.value,
  }));

  const expandStyle = useAnimatedStyle(() => {
    // The expand affordance lives in the same vertical column as the send
    // button. When not overflowing it collapses its layout height (and
    // bottom margin) to zero, so the column shrinks down to just the send
    // button — no reserved empty slot above. Opacity capped at 0.7 to keep
    // the icon "muted" per the design intent.
    const o = overflowProgress.value;
    return {
      opacity: o * 0.7,
      height: o * EXPAND_HIT_SIZE,
      marginBottom: o * 4,
      transform: [{ scale: 0.7 + o * 0.3 }],
    };
  });

  const handleWrapperLayout = useCallback((e: LayoutChangeEvent) => {
    setContentWidth(e.nativeEvent.layout.width);
  }, []);

  const handleShadowLayout = useCallback((e: LayoutChangeEvent) => {
    setShadowHeight(e.nativeEvent.layout.height);
  }, []);

  const handleExpand = () => {
    sheetRef.current?.present();
  };

  const handleSheetSend = () => {
    onSend();
    sheetRef.current?.dismiss();
  };

  const renderBackdrop = (props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={0.5}
      pressBehavior="close"
    />
  );

  return (
    <>
      <View style={{ position: "relative" }}>
        {/* Focus glow ring — gradient with a soft drop-shadow halo. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: -RING_INSET,
              left: -RING_INSET,
              right: -RING_INSET,
              bottom: -RING_INSET,
              borderRadius: PILL_RADIUS + RING_INSET,
              shadowColor: theme["--color-primary"],
              shadowOpacity: 0.35,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 0 },
              elevation: 6,
            },
            ringStyle,
          ]}
        >
          <LinearGradient
            colors={gradientColors}
            start={gradientStart}
            end={gradientEnd}
            style={{
              ...StyleSheet.absoluteFillObject,
              borderRadius: PILL_RADIUS + RING_INSET,
            }}
          />
        </Animated.View>

        {/* Pill. alignItems: flex-end keeps the send button glued to the
            bottom while the text input grows upward. */}
        <View
          style={{
            borderRadius: PILL_RADIUS,
            backgroundColor: theme["--color-input"],
            flexDirection: "row",
            alignItems: "flex-end",
            paddingLeft: 20,
            paddingRight: (PILL_RADIUS * 2 - SEND_BUTTON_SIZE) / 2,
            paddingVertical: PILL_PADDING_Y,
          }}
        >
          {/* TextInput sized via min/maxHeight so RN auto-grows it
              natively on every keystroke (an explicit JS-controlled
              `height` batches contentSize updates until layout events on
              iOS — which is why the pill only grew on blur). Overflow
              detection is delegated to the offscreen shadow <Text> below
              so we don't depend on onContentSizeChange's clamping behavior.
              Flex:1 lives on the wrapper so width and height are cleanly
              separated; the wrapper's onLayout feeds the shadow's width. */}
          <View
            onLayout={handleWrapperLayout}
            style={{ flex: 1, position: "relative" }}
          >
            {contentWidth > 0 ? (
              <Text
                onLayout={handleShadowLayout}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: contentWidth,
                  opacity: 0,
                  fontFamily: "Poppins-Regular",
                  fontSize: 15,
                  lineHeight: LINE_HEIGHT,
                  paddingTop: TEXT_PADDING_Y,
                  paddingBottom: TEXT_PADDING_Y,
                  ...(Platform.OS === "android"
                    ? { includeFontPadding: false }
                    : null),
                }}
              >
                {value.length === 0 ? " " : value}
              </Text>
            ) : null}
            <TextInput
              ref={inputRef}
              value={value}
              onChangeText={onChangeText}
              onFocus={() => {
                setFocused(true);
                onFocus?.();
              }}
              onBlur={() => setFocused(false)}
              placeholder={placeholder}
              placeholderTextColor={theme["--color-foreground-muted"]}
              // Deliberately editable while streaming: the user can draft
              // their next message during a reply — only SENDING is blocked
              // (canSend gates the button; the screen + store guard the send
              // path itself).
              multiline
              scrollEnabled
              style={{
                minHeight: MIN_INPUT_HEIGHT,
                maxHeight: MAX_INPUT_HEIGHT,
                color: theme["--color-foreground"],
                fontFamily: "Poppins-Regular",
                fontSize: 15,
                lineHeight: LINE_HEIGHT,
                paddingTop: TEXT_PADDING_Y,
                paddingBottom: TEXT_PADDING_Y,
                ...(Platform.OS === "android"
                  ? { includeFontPadding: false, textAlignVertical: "center" }
                  : null),
              }}
            />
          </View>

          {/* Right column: expand on top (collapsible), send at bottom. */}
          <View
            style={{
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Animated.View
              style={[
                {
                  width: EXPAND_HIT_SIZE,
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                },
                expandStyle,
              ]}
              pointerEvents={isOverflowing ? "auto" : "none"}
            >
              <Pressable
                onPress={handleExpand}
                accessibilityRole="button"
                accessibilityLabel={expandAccessibilityLabel}
                hitSlop={6}
                style={{
                  width: EXPAND_HIT_SIZE,
                  height: EXPAND_HIT_SIZE,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ArrowsOutSimple
                  size={20}
                  color={theme["--color-foreground-muted"]}
                  weight="bold"
                />
              </Pressable>
            </Animated.View>

            <Pressable
            onPress={showStop ? onCancel : canSend ? onSend : undefined}
            disabled={!showStop && !canSend}
            accessibilityRole="button"
            accessibilityLabel={
              showStop ? cancelAccessibilityLabel : sendAccessibilityLabel
            }
            accessibilityState={{ disabled: !showStop && !canSend }}
            hitSlop={8}
            style={{
              width: SEND_BUTTON_SIZE,
              height: SEND_BUTTON_SIZE,
              borderRadius: SEND_BUTTON_SIZE / 2,
              alignItems: "center",
              justifyContent: "center",
              // The "inactive" base color always lives underneath. The
              // active gradient fades over it via sendActiveStyle, so the
              // transition is a smooth cross-fade rather than a snap. While
              // streaming there's no fill at all — the stop affordance is
              // the spinner ring + icon.
              backgroundColor: showStop
                ? "transparent"
                : theme["--color-background-muted"],
              overflow: "hidden",
            }}
          >
            {showStop ? (
              <>
                {/* Faint static track the arc orbits on. */}
                <View
                  pointerEvents="none"
                  style={{
                    ...StyleSheet.absoluteFillObject,
                    borderRadius: SEND_BUTTON_SIZE / 2,
                    borderWidth: 2.5,
                    borderColor: theme["--color-border"],
                  }}
                />
                {/* Rotating arc: only the top border segment is painted, so
                    spinning the view reads as an indeterminate spinner. */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    {
                      ...StyleSheet.absoluteFillObject,
                      borderRadius: SEND_BUTTON_SIZE / 2,
                      borderWidth: 2.5,
                      borderColor: "transparent",
                      borderTopColor: theme["--color-primary"],
                    },
                    spinStyle,
                  ]}
                />
                {/* --color-foreground: white in dark mode (the ask), and it
                    stays near-black in light mode so the icon never vanishes
                    against the light pill. */}
                <Stop
                  size={16}
                  color={theme["--color-foreground"]}
                  weight="fill"
                />
              </>
            ) : (
              <>
                {/* Active layer: gradient + white icon, faded in by
                    sendActiveProgress. */}
                <Animated.View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFillObject, sendActiveStyle]}
                >
                  <LinearGradient
                    colors={gradientColors}
                    start={gradientStart}
                    end={gradientEnd}
                    style={StyleSheet.absoluteFillObject}
                  />
                </Animated.View>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFillObject,
                    centeredAbsolute,
                    sendActiveStyle,
                  ]}
                >
                  <ArrowFatUp size={22} color={activeIconColor} weight="fill" />
                </Animated.View>
                {/* Inactive layer: muted icon, faded out as the active
                    layer fades in. */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFillObject,
                    centeredAbsolute,
                    sendInactiveStyle,
                  ]}
                >
                  <ArrowFatUp
                    size={22}
                    color={theme["--color-foreground-muted"]}
                    weight="fill"
                  />
                </Animated.View>
              </>
            )}
          </Pressable>
          </View>
        </View>
      </View>

      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        // On wide screens (iPad) cap the sheet to the same content column as
        // the rest of the app and center it, instead of stretching edge-to-edge.
        containerStyle={{ alignItems: "center" }}
        style={{ width: "100%", maxWidth: MAX_CONTENT_WIDTH }}
        backgroundStyle={{ backgroundColor: theme["--color-card"] }}
        handleIndicatorStyle={{
          backgroundColor: theme["--color-foreground-muted"],
        }}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        <BottomSheetView style={{ flex: 1, paddingBottom: 16 }}>
          {/* Header row: empty on the left, collapse button on the right.
              Tapping it dismisses the sheet — matches the pan-down gesture
              affordance with an explicit button for accessibility. */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              paddingHorizontal: 16,
              paddingTop: 2,
              paddingBottom: 6,
            }}
          >
            <BottomSheetTouchableOpacity
              onPress={() => sheetRef.current?.dismiss()}
              accessibilityRole="button"
              accessibilityLabel={collapseAccessibilityLabel}
              hitSlop={8}
              activeOpacity={0.82}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme["--color-background-muted"],
              }}
            >
              <ArrowsInSimple
                size={18}
                color={theme["--color-foreground-muted"]}
                weight="bold"
              />
            </BottomSheetTouchableOpacity>
          </View>

          {/* The text input fills the available height between header and
              the send-button row. `flex: 1` on the multiline TextInput
              gives it a fixed visual frame so content scrolls internally
              rather than the input itself growing — which is what makes the
              modal feel like "a big writing surface" regardless of draft
              length. */}
          <View style={{ flex: 1, paddingHorizontal: 20 }}>
            <BottomSheetTextInput
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={theme["--color-foreground-muted"]}
              multiline
              autoFocus
              style={{
                flex: 1,
                color: theme["--color-foreground"],
                fontFamily: "Poppins-Regular",
                fontSize: 16,
                lineHeight: 22,
                paddingTop: 12,
                paddingBottom: 12,
                textAlignVertical: "top",
                ...(Platform.OS === "android"
                  ? { includeFontPadding: false }
                  : null),
              }}
            />
          </View>

          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              paddingHorizontal: 20,
              paddingTop: 8,
            }}
          >
            <BottomSheetTouchableOpacity
              onPress={handleSheetSend}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel={sendAccessibilityLabel}
              accessibilityState={{ disabled: !canSend }}
              hitSlop={8}
              activeOpacity={0.86}
              style={{
                width: SEND_BUTTON_SIZE + 4,
                height: SEND_BUTTON_SIZE + 4,
                borderRadius: (SEND_BUTTON_SIZE + 4) / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme["--color-background-muted"],
                overflow: "hidden",
              }}
            >
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject, sendActiveStyle]}
              >
                <LinearGradient
                  colors={gradientColors}
                  start={gradientStart}
                  end={gradientEnd}
                  style={StyleSheet.absoluteFillObject}
                />
              </Animated.View>
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  centeredAbsolute,
                  sendActiveStyle,
                ]}
              >
                <ArrowFatUp size={24} color={activeIconColor} weight="fill" />
              </Animated.View>
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  centeredAbsolute,
                  sendInactiveStyle,
                ]}
              >
                <ArrowFatUp
                  size={24}
                  color={theme["--color-foreground-muted"]}
                  weight="fill"
                />
              </Animated.View>
            </BottomSheetTouchableOpacity>
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    </>
  );
  },
);
