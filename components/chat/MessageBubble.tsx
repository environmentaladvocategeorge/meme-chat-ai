import { useAttachmentViewer } from "@/components/AttachmentViewer";
import { MemeAvatar } from "@/components/MemeAvatar";
import {
  MessageActions,
  type MessageReaction,
} from "@/components/MessageActions";
import { MessageGifAttachments } from "@/components/MessageGifAttachments";
import { MessageImageAttachments } from "@/components/MessageImageAttachments";
import { SelectableText } from "@/components/SelectableText";
import { Typography } from "@/components/Typography";
import { stripMemeArtifacts } from "@/domain/agentText";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { useChatStore } from "@/store/chat";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowClockwise, WarningCircle } from "phosphor-react-native";
import { useColorScheme } from "nativewind";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import Markdown, {
  type RenderRules,
} from "react-native-markdown-display";
import {
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SCROLL_SIGN, useBubbleGradient } from "./BubbleGradientContext";
import { TIME_REVEAL_WIDTH, useTimeReveal } from "./TimeRevealContext";
import {
  formatMessageTimestamp,
  shouldRenderMarkdown,
} from "./messageFormat";
import { StreamingFadeText } from "./StreamingFadeText";
import { useThinkingLabel } from "./ThinkingLabelContext";
import { ThinkingText } from "./ThinkingText";
import { type RenderMessage } from "./types";

// Visual constants for the bubble layout. iMessage-style asymmetric
// corners: a single corner on the sender's side is squared off (smaller
// radius) to read as the "tail" pointing at the speaker.
const BUBBLE_RADIUS = 20;
const BUBBLE_TAIL_RADIUS = 6;
const AVATAR_SIZE = 36;
const AVATAR_GUTTER = 10;
// Persona identity now lives in the header, so agent messages no longer carry a
// left avatar. We keep a modest inset on each speaker's FAR side (so bubbles
// don't span fully edge-to-edge and the speech-side asymmetry survives) while
// reclaiming the old avatar-column width for the message content.
const MESSAGE_EDGE_INSET = 16;

// Renders the playful in-flight label. A separate component so only the ONE
// thinking bubble subscribes to ThinkingLabelContext — if MessageBubble itself
// consumed it, every bubble would re-render each turn when the label
// reshuffles, defeating the memo.
function StreamingThinkingText({
  baseColor,
  gradient,
}: {
  baseColor: string;
  gradient: readonly string[];
}) {
  const label = useThinkingLabel();
  return <ThinkingText label={label} baseColor={baseColor} gradient={gradient} />;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  retryLabel,
  errorLabel,
  onRetry,
  onRate,
  onEmoji,
  isLastAgent = false,
  onReplay,
}: {
  message: RenderMessage;
  retryLabel: string;
  errorLabel: string;
  onRetry: () => void;
  onRate: (serverId: string, reaction: MessageReaction) => void;
  onEmoji: (serverId: string, emoji: string) => void;
  // True only for the conversation's most recent agent reply — the one turn
  // replay is allowed to regenerate.
  isLastAgent?: boolean;
  onReplay: (serverId: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const primaryGradient = gradients[colorScheme ?? "light"].primary;
  const { bubble } = useChatAppearance();
  const attachmentViewer = useAttachmentViewer();
  const mine = message.role === "user";
  const errored = message.status === "error";
  const isErrorCard = message.role === "agent" && errored;

  // The in-flight reply subscribes to the live stream itself, so delta flushes
  // re-render only this one bubble. For every other bubble the ternaries keep
  // the selector output constant ("" / null), so zustand never re-renders them
  // on a flush. Hooks run unconditionally — no rules-of-hooks issue.
  const isStreamingBubble =
    message.status === "streaming" && message.role === "agent";
  const streamingText = useChatStore((s) =>
    isStreamingBubble ? s.streamingText : "",
  );
  const streamingMeme = useChatStore((s) =>
    isStreamingBubble ? s.streamingMeme : null,
  );
  const streamingGif = useChatStore((s) =>
    isStreamingBubble ? s.streamingGif : null,
  );
  // Mirrors texting a friend: sending a GIF/meme doesn't stop your "typing…"
  // indicator — you're still composing the message. The media lands (gif/meme
  // event), the indicator stays up through the gap before the responder call
  // streams, and it drops the moment the first tokens arrive (so it never
  // shows alongside the text).
  const thinking = isStreamingBubble && streamingText.length === 0;

  // The user's own bubble can be a custom gradient or a custom solid (paid
  // App Customization); agent/error bubbles are unaffected.
  const useGradient = mine && !errored && bubble.kind === "gradient";
  const useSolidBubble = mine && !errored && bubble.kind === "solid";
  const timestampLabel = formatMessageTimestamp(message.createdAt);

  // Agent replies may carry meme markdown/attachment artifacts (stripped on the
  // backend now, but older stored messages and the live stream still need it).
  const liveText = isStreamingBubble ? streamingText : message.text;
  const rawText = errored && liveText.length === 0 ? errorLabel : liveText;
  const messageText =
    message.role === "agent" ? stripMemeArtifacts(rawText) : rawText;

  // A user turn may carry staged/persisted Klipy memes. Render the images, and
  // only render the text bubble when there's actual text (or the streaming
  // "thinking" placeholder) — so an image-only turn shows just the image.
  const messageImages = isStreamingBubble
    ? streamingMeme
      ? [streamingMeme]
      : []
    : (message.images ?? []);
  const hasImages = messageImages.length > 0;
  const messageGifs = isStreamingBubble
    ? streamingGif
      ? [streamingGif]
      : []
    : (message.gifs ?? []);
  const hasGifs = messageGifs.length > 0;
  const hasTextBubble = thinking || messageText.length > 0;

  // The copy/thumbs action row shows only on a finalized agent reply (one
  // that's persisted, so it has a serverId to rate) — never while streaming,
  // on the error card, or on user turns.
  const showActions =
    message.role === "agent" &&
    !errored &&
    !thinking &&
    message.status === "complete" &&
    typeof message.serverId === "string" &&
    messageText.length > 0;

  const messageColor = mine
    ? bubble.textColor
    : errored
      ? theme["--color-error"]
      : theme["--color-foreground"];

  const mutedMessageColor = mine
    ? bubble.textColor
    : theme["--color-foreground-muted"];

  const codeBackgroundColor = mine
    ? bubble.codeBackgroundColor
    : theme["--color-background-secondary"];

  const borderColor = mine ? bubble.borderColor : theme["--color-border"];
  const selectionColor = theme["--color-primary-muted"];

  const markdownStyles = useMemo(
    () =>
      StyleSheet.create({
        body: {
          color: messageColor,
          fontSize: 17,
          lineHeight: 24,
        },
        text: {
          color: messageColor,
        },
        paragraph: {
          marginTop: 0,
          marginBottom: 8,
        },
        strong: {
          color: messageColor,
          fontWeight: "800",
        },
        em: {
          color: messageColor,
          fontStyle: "italic",
        },
        s: {
          color: messageColor,
          textDecorationLine: "line-through",
        },
        link: {
          color: messageColor,
          fontWeight: "700",
          textDecorationLine: "underline",
        },
        heading1: {
          color: messageColor,
          fontSize: 24,
          lineHeight: 30,
          fontWeight: "800",
          marginTop: 4,
          marginBottom: 8,
        },
        heading2: {
          color: messageColor,
          fontSize: 21,
          lineHeight: 27,
          fontWeight: "800",
          marginTop: 4,
          marginBottom: 7,
        },
        heading3: {
          color: messageColor,
          fontSize: 19,
          lineHeight: 25,
          fontWeight: "800",
          marginTop: 4,
          marginBottom: 6,
        },
        heading4: {
          color: messageColor,
          fontSize: 17,
          lineHeight: 24,
          fontWeight: "800",
          marginTop: 4,
          marginBottom: 4,
        },
        heading5: {
          color: messageColor,
          fontSize: 16,
          lineHeight: 23,
          fontWeight: "800",
          marginTop: 4,
          marginBottom: 4,
        },
        heading6: {
          color: mutedMessageColor,
          fontSize: 15,
          lineHeight: 22,
          fontWeight: "800",
          marginTop: 4,
          marginBottom: 4,
        },
        bullet_list: {
          marginTop: 2,
          marginBottom: 2,
        },
        ordered_list: {
          marginTop: 2,
          marginBottom: 2,
        },
        list_item: {
          marginBottom: 2,
        },
        // The library defaults these to `flex: 1` (flexBasis 0), so the item
        // text contributes no intrinsic width. Inside this content-sized
        // bubble that collapses the whole list to the marker's width and the
        // text wraps one character per line. Size the content by its text and
        // let it shrink so long items still wrap at the bubble's max width.
        bullet_list_content: {
          flex: 0,
          flexShrink: 1,
          flexBasis: "auto",
        },
        ordered_list_content: {
          flex: 0,
          flexShrink: 1,
          flexBasis: "auto",
        },
        bullet_list_icon: {
          color: messageColor,
          marginRight: 6,
        },
        ordered_list_icon: {
          color: messageColor,
          marginRight: 6,
        },
        blockquote: {
          borderLeftWidth: 3,
          borderLeftColor: borderColor,
          paddingLeft: 10,
          marginVertical: 6,
          opacity: 0.92,
        },
        code_inline: {
          color: messageColor,
          backgroundColor: codeBackgroundColor,
          borderRadius: 6,
          paddingHorizontal: 5,
          paddingVertical: 2,
          fontFamily: Platform.select({
            ios: "Menlo",
            android: "monospace",
            default: "monospace",
          }),
        },
        code_block: {
          color: messageColor,
          backgroundColor: codeBackgroundColor,
          borderRadius: 12,
          padding: 10,
          marginVertical: 6,
          fontFamily: Platform.select({
            ios: "Menlo",
            android: "monospace",
            default: "monospace",
          }),
        },
        fence: {
          color: messageColor,
          backgroundColor: codeBackgroundColor,
          borderRadius: 12,
          padding: 10,
          marginVertical: 6,
          fontFamily: Platform.select({
            ios: "Menlo",
            android: "monospace",
            default: "monospace",
          }),
        },
        hr: {
          backgroundColor: borderColor,
          height: 1,
          marginVertical: 8,
        },
        table: {
          borderWidth: 1,
          borderColor,
          borderRadius: 8,
          marginVertical: 6,
        },
        th: {
          color: messageColor,
          fontWeight: "800",
          borderColor,
          padding: 6,
        },
        td: {
          color: messageColor,
          borderColor,
          padding: 6,
        },
      }),
    [borderColor, codeBackgroundColor, messageColor, mutedMessageColor],
  );

  const selectableMarkdownRules = useMemo<RenderRules>(
    () => ({
      // Block-root inline containers (textgroup/inline) and standalone code
      // blocks carry `uiTextView` so they become the native UITextView host on
      // a real build; the inline runs nested inside them (strong/em/text/…)
      // render as child text without it. In Expo Go SelectableText is a plain
      // <Text> and `uiTextView` is dropped, so behavior is unchanged.
      strong: (node, children, _parent, styles) => (
        <SelectableText
          key={node.key}
          selectable
          selectionColor={selectionColor}
          style={styles.strong}
        >
          {children}
        </SelectableText>
      ),
      em: (node, children, _parent, styles) => (
        <SelectableText
          key={node.key}
          selectable
          selectionColor={selectionColor}
          style={styles.em}
        >
          {children}
        </SelectableText>
      ),
      s: (node, children, _parent, styles) => (
        <SelectableText
          key={node.key}
          selectable
          selectionColor={selectionColor}
          style={styles.s}
        >
          {children}
        </SelectableText>
      ),
      code_inline: (node, _children, _parent, styles, inheritedStyles = {}) => (
        <SelectableText
          key={node.key}
          selectable
          selectionColor={selectionColor}
          style={[inheritedStyles, styles.code_inline]}
        >
          {node.content}
        </SelectableText>
      ),
      code_block: (node, _children, _parent, styles, inheritedStyles = {}) => {
        const content =
          typeof node.content === "string" && node.content.endsWith("\n")
            ? node.content.slice(0, -1)
            : node.content;

        return (
          <SelectableText
            key={node.key}
            selectable
            uiTextView
            selectionColor={selectionColor}
            style={[inheritedStyles, styles.code_block]}
          >
            {content}
          </SelectableText>
        );
      },
      fence: (node, _children, _parent, styles, inheritedStyles = {}) => {
        const content =
          typeof node.content === "string" && node.content.endsWith("\n")
            ? node.content.slice(0, -1)
            : node.content;

        return (
          <SelectableText
            key={node.key}
            selectable
            uiTextView
            selectionColor={selectionColor}
            style={[inheritedStyles, styles.fence]}
          >
            {content}
          </SelectableText>
        );
      },
      text: (node, _children, _parent, styles, inheritedStyles = {}) => (
        <SelectableText
          key={node.key}
          selectable
          selectionColor={selectionColor}
          style={[inheritedStyles, styles.text]}
        >
          {node.content}
        </SelectableText>
      ),
      textgroup: (node, children, _parent, styles) => (
        <SelectableText
          key={node.key}
          selectable
          uiTextView
          selectionColor={selectionColor}
          style={styles.textgroup}
        >
          {children}
        </SelectableText>
      ),
      hardbreak: (node, _children, _parent, styles) => (
        <SelectableText
          key={node.key}
          selectable
          selectionColor={selectionColor}
          style={styles.hardbreak}
        >
          {"\n"}
        </SelectableText>
      ),
      softbreak: (node, _children, _parent, styles) => (
        <SelectableText
          key={node.key}
          selectable
          selectionColor={selectionColor}
          style={styles.softbreak}
        >
          {"\n"}
        </SelectableText>
      ),
      inline: (node, children, _parent, styles) => (
        <SelectableText
          key={node.key}
          selectable
          uiTextView
          selectionColor={selectionColor}
          style={styles.inline}
        >
          {children}
        </SelectableText>
      ),
      span: (node, children, _parent, styles) => (
        <SelectableText
          key={node.key}
          selectable
          selectionColor={selectionColor}
          style={styles.span}
        >
          {children}
        </SelectableText>
      ),
    }),
    [selectionColor],
  );

  // Entering animation. Plays once on mount: a quick opacity + tiny scale
  // bounce. We use a translateY of +6 so it nudges up into place — subtle
  // enough not to "swim" with the inverted FlatList's flipped transform.
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.94);
  const translateY = useSharedValue(6);

  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
    scale.value = withSpring(1, { damping: 14, stiffness: 220, mass: 0.7 });
    translateY.value = withTiming(0, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [opacity, scale, translateY]);

  // The avatar sits in this node, so it gets opacity + translateY ONLY — never
  // scale. The spring overshoots past 1.0, and scaling resamples the avatar
  // bitmap each frame, which made the icon (and, before it, the emoji) look
  // distorted on mount until the spring settled. Opacity/translate don't
  // resample, so the avatar fades + nudges in crisp.
  const entranceStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  // Scale lives here instead, applied only to the bubble column — keeping the
  // springy "pop" on the message body without ever touching the avatar.
  const bubbleScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // iMessage-style swipe-to-reveal timestamps. The whole row slides left as the
  // thread is dragged (shared progress from chat.tsx) and the timestamp pinned
  // at the right margin fades in to fill the freed space. Both read the same
  // shared value, so the swipe re-renders nothing; `?? 0` keeps the worklet
  // safe when no provider is mounted (e.g. in isolation tests).
  const timeReveal = useTimeReveal();
  const rowRevealStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -(timeReveal?.progress.value ?? 0) * TIME_REVEAL_WIDTH },
    ],
  }));
  const timestampRevealStyle = useAnimatedStyle(() => ({
    opacity: timeReveal?.progress.value ?? 0,
  }));

  // Page-level gradient anchoring (user bubbles only). We measure the bubble's
  // window Y and the scroll offset at that instant, then translate a
  // screen-tall gradient so the slice showing through the bubble matches its
  // position on the page. Re-anchors on layout + whenever the list signals a
  // shift (measureTick). See BubbleGradientContext.
  const bubbleGradient = useBubbleGradient();
  const { height: windowHeight } = useWindowDimensions();
  const bubbleRef = useRef<View>(null);
  const anchorWinY = useSharedValue(0);
  const anchorScroll = useSharedValue(0);
  const gradientReady = useSharedValue(0);

  const remeasureGradient = useCallback(() => {
    const node = bubbleRef.current;
    if (!node || !useGradient || !bubbleGradient) return;
    node.measureInWindow((_x, y) => {
      if (typeof y !== "number" || !Number.isFinite(y)) return;
      anchorWinY.value = y;
      anchorScroll.value = bubbleGradient.scrollY.value;
      gradientReady.value = withTiming(1, { duration: 200 });
    });
  }, [useGradient, bubbleGradient, anchorWinY, anchorScroll, gradientReady]);

  // Re-measure on every tick of the shared measureTick — and once on mount
  // (the reaction's first run has prev === null, so it always fires). The tick
  // is a SharedValue, so bumping it re-renders nothing; only this reaction
  // runs, and `measureInWindow` itself stays on the JS thread via runOnJS.
  useAnimatedReaction(
    () => bubbleGradient?.measureTick.value ?? 0,
    (tick, prev) => {
      if (useGradient && tick !== prev) runOnJS(remeasureGradient)();
    },
    [useGradient, remeasureGradient, bubbleGradient],
  );

  const pageGradientStyle = useAnimatedStyle(() => {
    const screenY = bubbleGradient
      ? anchorWinY.value +
        SCROLL_SIGN * (bubbleGradient.scrollY.value - anchorScroll.value)
      : 0;
    return {
      opacity: gradientReady.value,
      transform: [{ translateY: -screenY }],
    };
  });

  // Bubble bg: the user's bubble uses a vertical gradient (top → bottom)
  // of the brand colors; the agent's uses --color-card, the same subtle
  // surface the chat input pill sits on, so they read as part of the
  // same surface family. Error variant uses the error-muted tone.
  //
  // For gradient bubbles the visible sweep is a separate, page-anchored layer
  // that only fades in once the bubble has measured its on-screen position.
  // Until then — including when the inverted FlatList remounts a recycled cell
  // on send — that layer is invisible, so we paint the gradient's top color
  // here as a solid fallback. Without it the bubble would flash fully
  // transparent ("loses the background, then renders"); with it the bubble
  // always has a fill and the anchored gradient just crossfades in on top.
  const gradientFallback =
    bubble.gradientColors?.[0] ?? primaryGradient.colors[0];
  const bubbleBg = useGradient
    ? gradientFallback
    : useSolidBubble
      ? (bubble.solidColor ?? theme["--color-card"])
      : errored
        ? theme["--color-error-muted"]
        : theme["--color-card"];

  // Asymmetric corner radius: square off the bottom corner on the speaker's
  // side. iMessage-style "tail" without needing an actual triangle glyph.
  const cornerStyle = mine
    ? { borderBottomRightRadius: BUBBLE_TAIL_RADIUS }
    : { borderBottomLeftRadius: BUBBLE_TAIL_RADIUS };

  const rowStyle: import("react-native").ViewStyle = {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: mine ? "flex-end" : "flex-start",
    // Small far-side inset, mirrored across the visual axis, so neither
    // speaker's bubbles run the full width (no avatar column to reserve now).
    paddingLeft: mine ? MESSAGE_EDGE_INSET : 0,
    paddingRight: mine ? 0 : MESSAGE_EDGE_INSET,
  };

  // Failed turn: a self-contained agent card with the worried mascot, a
  // headline + explanation, and the retry action all in one place — instead
  // of a bare error bubble plus a stray "try again" pill under the user's
  // message.
  if (isErrorCard) {
    const signedOut = message.errorKind === "signed-out";
    const hateSpeech = message.errorKind === "hate_speech";
    const errorTitle = signedOut
      ? t("chat.errors.signedOutTitle")
      : hateSpeech
        ? t("chat.errors.hateSpeechTitle")
        : t("chat.errors.title");
    const errorBody = signedOut
      ? t("chat.errors.signedOut")
      : hateSpeech
        ? t("chat.errors.hateSpeech")
        : message.text.length > 0
          ? message.text
          : errorLabel;

    return (
      <Animated.View style={[{ gap: 6 }, entranceStyle]}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            paddingRight: AVATAR_SIZE + AVATAR_GUTTER,
          }}
        >
          <View style={{ marginRight: AVATAR_GUTTER, paddingTop: 2 }}>
            <MemeAvatar variant="worried" size={AVATAR_SIZE} />
          </View>

          <View
            style={{
              flex: 1,
              borderRadius: BUBBLE_RADIUS,
              borderBottomLeftRadius: BUBBLE_TAIL_RADIUS,
              paddingHorizontal: 14,
              paddingVertical: 12,
              gap: 10,
              backgroundColor: theme["--color-error-muted"],
              borderWidth: 1,
              borderColor: theme["--color-error"],
            }}
          >
            <View
              style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}
            >
              <WarningCircle
                size={18}
                color={theme["--color-error"]}
                weight="fill"
                style={{ marginTop: 1 }}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Typography
                  variant="body-sm"
                  weight="bold"
                  style={{ color: theme["--color-foreground"] }}
                >
                  {errorTitle}
                </Typography>
                <Typography
                  variant="caption"
                  style={{ color: theme["--color-foreground-secondary"] }}
                >
                  {errorBody}
                </Typography>
              </View>
            </View>

            {message.retry ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={retryLabel}
                onPress={onRetry}
                hitSlop={6}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  alignSelf: "flex-start",
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: theme["--color-error"],
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <ArrowClockwise size={14} color="#FFFFFF" weight="bold" />
                <Typography
                  variant="caption"
                  style={{ color: "#FFFFFF", fontWeight: "800" }}
                >
                  {retryLabel}
                </Typography>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[{ gap: 6 }, entranceStyle]}>
      <View style={{ position: "relative" }}>
        {/* Timestamp pinned at the right margin, revealed as the thread is
            swiped left (TimeRevealContext) — the same right-edge stamp for both
            speakers, iMessage-style. */}
        {timestampLabel ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: TIME_REVEAL_WIDTH,
                alignItems: "center",
                justifyContent: "center",
              },
              timestampRevealStyle,
            ]}
          >
            <Typography
              variant="micro"
              numberOfLines={1}
              style={{ color: theme["--color-foreground-muted"] }}
            >
              {timestampLabel}
            </Typography>
          </Animated.View>
        ) : null}

        <Animated.View style={[rowStyle, rowRevealStyle]}>
        <Animated.View
          style={[
            {
              flexShrink: 1,
              maxWidth: "100%",
              alignItems: mine ? "flex-end" : "flex-start",
              gap: 6,
            },
            bubbleScaleStyle,
          ]}
        >
          {hasImages ? (
            <MessageImageAttachments
              images={messageImages}
              align={mine ? "end" : "start"}
              imageLabel={t("chat.attachments.imageLabel")}
              onPressImage={(image) =>
                attachmentViewer.open({
                  kind: "meme",
                  displayUrl: image.url,
                  sourceUrl: image.url,
                })
              }
            />
          ) : null}

          {hasGifs ? (
            <MessageGifAttachments
              gifs={messageGifs}
              align={mine ? "end" : "start"}
              gifLabel={t("chat.attachments.gifLabel")}
              onPressGif={(gif) =>
                attachmentViewer.open({
                  kind: "gif",
                  displayUrl: gif.url,
                  // Static watermarked download uses the GIF's still poster.
                  sourceUrl: gif.previewUrl,
                })
              }
            />
          ) : null}

          {hasTextBubble ? (
            // A plain View, not a Pressable: a touchable here would claim the
            // long-press and block native text selection. The message text owns
            // its own gesture now (each Text is `selectable`), and timestamps
            // moved to the thread-wide swipe reveal (TimeRevealContext).
            <View
              ref={bubbleRef}
              onLayout={useGradient ? remeasureGradient : undefined}
              accessibilityLabel={
                timestampLabel
                  ? `${messageText}. ${timestampLabel}`
                  : messageText
              }
              style={{
                maxWidth: "100%",
                borderRadius: BUBBLE_RADIUS,
                ...cornerStyle,
                paddingHorizontal: 14,
                paddingVertical: 10,
                overflow: "hidden",
                backgroundColor: bubbleBg,
              }}
            >
              {useGradient ? (
                // One screen-tall gradient, slid so the slice behind this bubble
                // matches its place on the page. `overflow: hidden` on the
                // bubble masks it to the bubble shape.
                <Animated.View
                  pointerEvents="none"
                  style={[
                    {
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: 0,
                      height: windowHeight,
                    },
                    pageGradientStyle,
                  ]}
                >
                  <LinearGradient
                    colors={bubble.gradientColors ?? primaryGradient.colors}
                    start={bubble.gradientStart ?? { x: 0, y: 0 }}
                    end={bubble.gradientEnd ?? { x: 0, y: 1 }}
                    style={{ width: "100%", height: windowHeight }}
                  />
                </Animated.View>
              ) : null}
              {thinking ? (
                <StreamingThinkingText
                  baseColor={theme["--color-foreground-muted"]}
                  gradient={primaryGradient.colors}
                />
              ) : shouldRenderMarkdown(messageText) ? (
                <Markdown rules={selectableMarkdownRules} style={markdownStyles}>
                  {messageText}
                </Markdown>
              ) : isStreamingBubble ? (
                // In-flight reply: newly streamed runs of text ease in
                // (ChatGPT-style) instead of popping. Markdown replies above
                // keep the plain re-parse — chunk fades can't survive a
                // markdown re-render. Settles back to the Typography branch
                // when the finalized message replaces this bubble's content.
                <StreamingFadeText
                  text={messageText}
                  color={messageColor}
                  selectionColor={selectionColor}
                />
              ) : (
                // Finalized plain (non-markdown) message. SelectableText is the
                // UITextView host on a real build (drag-to-highlight) and a plain
                // <Text> in Expo Go. Mirrors Typography's body face by hand since
                // it's no longer a Typography node.
                <SelectableText
                  selectable
                  uiTextView
                  selectionColor={selectionColor}
                  style={{
                    color: messageColor,
                    fontFamily: "Poppins-Regular",
                    fontSize: 17,
                    lineHeight: 24,
                    includeFontPadding: false,
                  }}
                >
                  {messageText}
                </SelectableText>
              )}
            </View>
          ) : null}

          {isStreamingBubble ? (
            // Small stand-in under the in-flight bubble. The dock's fade ramp
            // ducks out during the stream (see chat.tsx dockFadeOpacity), so
            // this no longer needs to clear it — it just softens the push when
            // the full action row lands at finalize.
            <View style={{ height: 10 }} />
          ) : null}

          {showActions && message.serverId ? (
            <MessageActions
              text={messageText}
              reaction={message.reaction}
              onRate={(reaction) => onRate(message.serverId!, reaction)}
              emojiReaction={message.emojiReaction}
              onEmoji={(emoji) => onEmoji(message.serverId!, emoji)}
              onReplay={
                isLastAgent ? () => onReplay(message.serverId!) : undefined
              }
              labels={{
                copy: t("chat.actions.copy"),
                copied: t("chat.actions.copied"),
                up: t("chat.actions.thumbsUp"),
                down: t("chat.actions.thumbsDown"),
                replay: t("chat.actions.regenerate"),
                react: t("chat.actions.react"),
              }}
            />
          ) : null}
        </Animated.View>
        </Animated.View>
      </View>
    </Animated.View>
  );
});
