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
//   - The pill renders as native Liquid Glass where available (GlassSurface),
//     falling back to the solid input surface elsewhere. No focus treatment:
//     the keyboard being up already says the composer is focused.

import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
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
  type StyleProp,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Exported for ComposerSkeleton, which mirrors the composer's resting
// geometry (pill height = PILL_RADIUS * 2) while the app boots.
export const PILL_RADIUS = 26;
const SEND_BUTTON_SIZE = 36;
const EXPAND_HIT_SIZE = 32;
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

// Shared geometry for the composer's send / stop button so the two states sit
// in the exact same spot.
const sendButtonContainerStyle = {
  width: SEND_BUTTON_SIZE,
  height: SEND_BUTTON_SIZE,
  // The button bottom-anchors to the input row (flex-end), so it tracks the last
  // line as the input grows. Half the row/button difference keeps it centered on
  // a single line and lifted off the pill floor when grown.
  marginBottom: (MIN_INPUT_HEIGHT - SEND_BUTTON_SIZE) / 2,
} as const;

const sendButtonBaseStyle = {
  width: SEND_BUTTON_SIZE,
  height: SEND_BUTTON_SIZE,
  borderRadius: SEND_BUTTON_SIZE / 2,
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
} as const;

// The streaming "stop" affordance: a faint track with a bright accent arc
// rotating over it. Its OWN component (and its own `spin` SharedValue) so the
// rotation can never leak onto the send button — they're different component
// types, so React fully remounts when streaming flips, instead of reusing the
// same host view and leaving the send icon frozen at the spinner's last angle.
function StopButton({
  onCancel,
  accessibilityLabel,
}: {
  onCancel: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  // Created on mount, cancelled on unmount → every stream gets a clean spin from
  // 0, and nothing survives the unmount to taint the send button.
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(spin);
  }, [spin]);
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  return (
    <AppPressable
      onPress={onCancel}
      haptic
      pressScale={0.08}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      containerStyle={sendButtonContainerStyle}
      // No fill while streaming — the affordance is the ring + icon.
      style={{ ...sendButtonBaseStyle, backgroundColor: "transparent" }}
    >
      {/* Faint full track the arc sweeps over. */}
      <View
        pointerEvents="none"
        style={{
          ...StyleSheet.absoluteFillObject,
          borderRadius: SEND_BUTTON_SIZE / 2,
          borderWidth: 3,
          borderColor: theme["--color-border"],
        }}
      />
      {/* Rotating accent arc: a bright ~half-ring orbiting the track — a
          recognizable "working, tap to stop" loader. The two transparent edges
          let the track show through as the lit segment sweeps. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            ...StyleSheet.absoluteFillObject,
            borderRadius: SEND_BUTTON_SIZE / 2,
            borderWidth: 3,
            borderColor: "transparent",
            borderTopColor: theme["--color-primary"],
            borderRightColor: theme["--color-primary"],
          },
          spinStyle,
        ]}
      />
      <Stop size={14} color={theme["--color-foreground"]} weight="fill" />
    </AppPressable>
  );
}

// The send button: a muted base with the accent gradient + arrow cross-fading
// in as the turn becomes sendable. Separate component from StopButton (see the
// note there). The active/inactive cross-fade styles are driven by the parent's
// sendActiveProgress (shared with the expanded-composer send button) and passed
// in, so both buttons fade in unison.
function SendButton({
  onSend,
  canSend,
  accessibilityLabel,
  gradientColors,
  gradientStart,
  gradientEnd,
  activeIconColor,
  activeStyle,
  inactiveStyle,
}: {
  onSend: () => void;
  canSend: boolean;
  accessibilityLabel: string;
  gradientColors: readonly [string, string, ...string[]];
  gradientStart: { x: number; y: number };
  gradientEnd: { x: number; y: number };
  activeIconColor: string;
  activeStyle: StyleProp<ViewStyle>;
  inactiveStyle: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <AppPressable
      onPress={canSend ? onSend : undefined}
      disabled={!canSend}
      haptic
      pressScale={0.08}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !canSend }}
      hitSlop={8}
      containerStyle={sendButtonContainerStyle}
      style={{
        ...sendButtonBaseStyle,
        // The inactive base always sits underneath; the active gradient
        // cross-fades over it via activeStyle for a smooth transition.
        backgroundColor: theme["--color-background-muted"],
      }}
    >
      {/* Active layer: gradient + white icon, faded in by sendActiveProgress. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, activeStyle]}
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
        style={[StyleSheet.absoluteFillObject, centeredAbsolute, activeStyle]}
      >
        <ArrowFatUp size={20} color={activeIconColor} weight="fill" />
      </Animated.View>
      {/* Inactive layer: muted icon, faded out as the active layer fades in. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, centeredAbsolute, inactiveStyle]}
      >
        <ArrowFatUp
          size={20}
          color={theme["--color-foreground-muted"]}
          weight="fill"
        />
      </Animated.View>
    </AppPressable>
  );
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
  // Overflow detection uses an offscreen "shadow" <Text> with the same
  // font + width as the visible TextInput. `shadowHeight` is that Text's
  // natural rendered height, and `contentWidth` lets us pin the shadow to
  // the same horizontal extent so wrapping matches what the TextInput
  // would do.
  const [shadowHeight, setShadowHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const overflowProgress = useSharedValue(0);
  // Drives the disabled ↔ active cross-fade on the send button — gradient
  // and white icon fade in, muted icon fades out (and vice versa) as the
  // user types or clears the draft, instead of snapping between states.
  const sendActiveProgress = useSharedValue(0);
  // Tap feedback: a quick dip-and-settle scale plus a faint brighten flash
  // when the user taps the text area — the small "alive" cue ChatGPT's
  // composer has. Lives only on the text region so the send/expand buttons
  // keep their own press animations.
  const pressScale = useSharedValue(1);
  const pressGlow = useSharedValue(0);
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

  const triggerPressFeedback = useCallback(() => {
    pressScale.value = withSequence(
      withTiming(0.98, { duration: 90, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 15, stiffness: 320, mass: 0.5 }),
    );
    pressGlow.value = withSequence(
      withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) }),
    );
  }, [pressScale, pressGlow]);

  const pressScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));
  // Peak ~10% white — a faint highlight, not a flash. pointerEvents none so it
  // never eats the tap that triggered it.
  const pressGlowStyle = useAnimatedStyle(() => ({
    opacity: pressGlow.value * 0.1,
  }));

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
      <Animated.View style={[{ position: "relative" }, pressScaleStyle]}>
        {/* Pill. alignItems: flex-end keeps the send button glued to the
            bottom while the text input grows upward. Liquid Glass where
            supported; the old solid input surface otherwise. */}
        <GlassSurface
          style={{
            borderRadius: PILL_RADIUS,
            flexDirection: "row",
            alignItems: "flex-end",
            paddingLeft: 16,
            paddingRight: (PILL_RADIUS * 2 - SEND_BUTTON_SIZE) / 2,
            paddingVertical: PILL_PADDING_Y,
          }}
          fallbackStyle={{ backgroundColor: theme["--color-input"] }}
        >
          {/* Tap brighten flash — sits over the surface, under the content. */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: "#FFFFFF", borderRadius: PILL_RADIUS },
              pressGlowStyle,
            ]}
          />
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
            onTouchStart={triggerPressFeedback}
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
              onFocus={() => onFocus?.()}
              placeholder={placeholder}
              placeholderTextColor={theme["--color-foreground-muted"]}
              // Deliberately editable while streaming: the user can draft
              // their next message during a reply — only SENDING is blocked
              // (canSend gates the button; the screen + store guard the send
              // path itself).
              multiline
              scrollEnabled
              // Return deliberately inserts a newline (the multiline
              // default) rather than sending — matches the Claude / ChatGPT
              // composer convention. Sending is the button's job.
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

            {/* Send and Stop are deliberately SEPARATE components, swapped by
                `showStop`. A single shared button reused the same host views
                across the swap, so the spinner's rotate transform lingered on
                the returning send icon (it came back "pointing at a random
                angle"). Different component types force a clean remount. */}
            {showStop ? (
              <StopButton
                onCancel={onCancel}
                accessibilityLabel={cancelAccessibilityLabel}
              />
            ) : (
              <SendButton
                onSend={onSend}
                canSend={canSend}
                accessibilityLabel={sendAccessibilityLabel}
                gradientColors={gradientColors}
                gradientStart={gradientStart}
                gradientEnd={gradientEnd}
                activeIconColor={activeIconColor}
                activeStyle={sendActiveStyle}
                inactiveStyle={sendInactiveStyle}
              />
            )}
          </View>
        </GlassSurface>
      </Animated.View>

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
                <ArrowFatUp size={22} color={activeIconColor} weight="fill" />
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
                  size={22}
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
