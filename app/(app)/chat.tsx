import { AgentAvatar } from "@/components/AgentAvatar";
import { AppHeader } from "@/components/AppHeader";
import { ChatInput } from "@/components/ChatInput";
import { MemeAvatar } from "@/components/MemeAvatar";
import {
  MessageActions,
  type MessageReaction,
} from "@/components/MessageActions";
import { MessageImageAttachments } from "@/components/MessageImageAttachments";
import { RotLevelSheet, type RotLevelSheetRef } from "@/components/RotLevelSheet";
import { TrendingMemeStrip } from "@/components/TrendingMemeStrip";
import { Typography } from "@/components/Typography";
import { stripMemeArtifacts } from "@/domain/agentText";
import {
  MAX_MESSAGE_IMAGES,
  trendingMemeToMessageImage,
  type MessageImage,
  type TrendingMeme,
} from "@/domain/memes";
import { useKlipy } from "@/hooks/useKlipy";
import {
  computeUsageState,
  formatResetMoment,
  type UsageState,
} from "@/domain/usage";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { useResetCountdown } from "@/hooks/useResetCountdown";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { useChatStore, type ChatMessage, type QuotaInfo } from "@/store/chat";
import { useDisplayPlan, useEntitlementStore } from "@/store/entitlement";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowClockwise,
  NotePencil,
  Sticker,
  WarningCircle,
  X,
} from "phosphor-react-native";
import { useColorScheme } from "nativewind";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-native-markdown-display";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  interpolateColor,
  runOnJS,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type RenderMessage = ChatMessage & {
  retry?: boolean;
  thinking?: boolean;
  // Which copy to show in the agent-side error card. Only set on synthesized
  // error bubbles (see `visibleMessages`).
  errorKind?: "generic" | "signed-out";
};

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
type BubbleGradientValue = {
  // Live content offset of the message list (driven on the UI thread).
  scrollY: SharedValue<number>;
  // Bumped whenever bubbles may have shifted on screen (content resize,
  // momentum settle) so each bubble re-measures its anchor.
  measureTick: number;
};
const BubbleGradientContext = createContext<BubbleGradientValue | null>(null);
const useBubbleGradient = () => useContext(BubbleGradientContext);

// The list is `inverted`, so a bubble's on-screen Y *increases* as the content
// offset grows (scrolling toward older messages pushes existing bubbles down).
// Flip to -1 if the gradient ever drifts the wrong way during a scroll.
const SCROLL_SIGN = 1;

// Stable list identity for a message bubble. An agent reply keeps the SAME
// key across its whole lifecycle — synthetic streaming placeholder → settled
// bridge → finalized Firestore message — because all three carry the same
// `inReplyToClientMessageId`. That continuity prevents the FlatList from
// unmounting and remounting the bubble (which replayed the entrance
// animation and caused the post-stream flicker).
function messageKey(item: RenderMessage): string {
  if (item.role === "agent" && item.inReplyToClientMessageId) {
    return `agent:${item.inReplyToClientMessageId}`;
  }
  return item.id;
}

function shouldRenderMarkdown(text: string): boolean {
  return /```|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|^#{1,6}\s|^\s*[-*]\s|^\s*\d+\.\s|^\s*>/m.test(
    text,
  );
}

// Right-hand header action on the chat screen: starts a fresh conversation.
// Deliberately a softer treatment than the gradient menu button — a muted
// outlined circle — so it reads as secondary and doesn't fight for attention.
function NewConversationButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: theme["--color-border"],
        backgroundColor: pressed
          ? theme["--color-card-pressed"]
          : theme["--color-card-muted"],
      })}
    >
      <NotePencil size={20} color={theme["--color-foreground"]} weight="bold" />
    </Pressable>
  );
}

// The memes affordance that sits just under the composer. A chunky little
// "sticker" chip: a rounded square icon badge + label. When the strip is open
// it fills with the brand gradient and lifts; closed, it's a soft card chip.
// Squishes on press so it feels tactile and playful rather than form-y.
function MemeToggleButton({
  label,
  open,
  onPress,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      hitSlop={8}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        borderRadius: 16,
        overflow: "hidden",
        // A gentle squish + dip on press; the open chip rides a touch higher
        // so its lift reads as "on".
        transform: [
          { scale: pressed ? 0.95 : 1 },
          { translateY: pressed ? 1 : open ? -1 : 0 },
        ],
        // Soft colored glow under the open (gradient) chip for a bit of pop.
        shadowColor: open ? theme["--color-primary"] : "#000000",
        shadowOpacity: open ? 0.32 : 0.08,
        shadowRadius: open ? 10 : 5,
        shadowOffset: { width: 0, height: open ? 4 : 2 },
        elevation: open ? 4 : 1,
      })}
    >
      {open ? (
        <LinearGradient
          colors={gradient.colors}
          start={gradient.start}
          end={gradient.end}
          style={StyleSheet.absoluteFillObject}
        />
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 7,
          paddingRight: 14,
          paddingVertical: 7,
          borderRadius: 16,
          borderWidth: open ? 0 : 1,
          borderColor: theme["--color-border"],
          backgroundColor: open ? "transparent" : theme["--color-card"],
        }}
      >
        {/* Icon badge — a little rounded-square "sticker" that flips colors
            with the open state. */}
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: open
              ? "rgba(255,255,255,0.22)"
              : theme["--color-primary-subtle"],
            transform: [{ rotate: "-8deg" }],
          }}
        >
          <Sticker
            size={18}
            color={open ? "#FFFFFF" : theme["--color-primary"]}
            weight="fill"
          />
        </View>
        <Typography
          variant="body-sm"
          weight="bold"
          style={{
            color: open ? "#FFFFFF" : theme["--color-foreground"],
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Typography>
      </View>
    </Pressable>
  );
}

// Emoji shown on the Rot Level chip per tier — mirrors RotLevelSheet's set so
// the chip previews the vibe that's currently dialed in.
const ROT_EMOJI = ["🤓", "😤", "💀"];

// The "Rot Level" affordance that sits beside the meme chip. Same chunky
// sticker-chip language as MemeToggleButton, but instead of a toggle it opens
// the rot-level bottom sheet. The icon badge wears the current level's emoji.
function RotLevelButton({
  label,
  level,
  onPress,
}: {
  label: string;
  level: number;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${level}`}
      hitSlop={8}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        borderRadius: 16,
        overflow: "hidden",
        transform: [
          { scale: pressed ? 0.95 : 1 },
          { translateY: pressed ? 1 : 0 },
        ],
        shadowColor: "#000000",
        shadowOpacity: 0.08,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
      })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 7,
          paddingRight: 14,
          paddingVertical: 7,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme["--color-border"],
          backgroundColor: theme["--color-card"],
        }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme["--color-primary-subtle"],
          }}
        >
          <Typography variant="body" style={{ fontSize: 16 }}>
            {ROT_EMOJI[Math.min(Math.max(level, 1), 3) - 1]}
          </Typography>
        </View>
        <Typography
          variant="body-sm"
          weight="bold"
          style={{ color: theme["--color-foreground"], letterSpacing: 0.2 }}
        >
          {label}
        </Typography>
      </View>
    </Pressable>
  );
}

// Staged attachment tray: the row of meme thumbnails above the composer that a
// user has picked but not yet sent. Each thumbnail keeps the KLIPY watermark
// (attribution) and a remove button. Shows a brief localized notice when the
// user tries to exceed MAX_MESSAGE_IMAGES.
function StagedAttachmentTray({
  images,
  showMaxNotice,
  onRemove,
}: {
  images: MessageImage[];
  showMaxNotice: boolean;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (images.length === 0 && !showMaxNotice) return null;

  return (
    <Animated.View entering={FadeIn.duration(180)} style={{ marginBottom: 8 }}>
      {images.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {images.map((image) => (
            <View key={image.id} style={{ width: 64, height: 64 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 12,
                  overflow: "hidden",
                  backgroundColor: theme["--color-card-muted"],
                  borderWidth: 1,
                  borderColor: theme["--color-border"],
                }}
              >
                <Image
                  source={{ uri: image.url }}
                  resizeMode="cover"
                  style={{ width: "100%", height: "100%" }}
                />
                {image.source === "klipy" ? (
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: 16,
                    }}
                  >
                    <LinearGradient
                      colors={["transparent", "rgba(0,0,0,0.45)"]}
                      style={StyleSheet.absoluteFill}
                    />
                  </View>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("chat.attachments.remove")}
                onPress={() => onRemove(image.id)}
                hitSlop={8}
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme["--color-foreground"],
                }}
              >
                <X
                  size={12}
                  color={theme["--color-background"]}
                  weight="bold"
                />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {showMaxNotice ? (
        <Typography
          variant="caption"
          style={{
            color: theme["--color-foreground-muted"],
            marginTop: images.length > 0 ? 6 : 0,
          }}
        >
          {t("chat.attachments.maxReached", { count: MAX_MESSAGE_IMAGES })}
        </Typography>
      ) : null}
    </Animated.View>
  );
}

export default function ChatScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const [draft, setDraft] = useState("");
  const [memesOpen, setMemesOpen] = useState(false);
  const rotSheetRef = useRef<RotLevelSheetRef>(null);
  // Memes the user has staged but not yet sent. Sent as multimodal image
  // inputs; capped at MAX_MESSAGE_IMAGES (the backend re-enforces the cap).
  const [stagedImages, setStagedImages] = useState<MessageImage[]>([]);
  // Brief "you can only attach N" notice, shown when a 4th meme is tapped.
  const [maxNotice, setMaxNotice] = useState(false);
  const maxNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Memes for the composer strip (trending + debounced KLIPY search). Modular —
  // the same hook can power a meme picker anywhere else in the app. `enabled`
  // defers the first network call until the strip is actually opened.
  const klipy = useKlipy({ perPage: 24, enabled: memesOpen });
  const conversationId = useChatStore((s) => s.conversationId);
  // Brainrot intensity dial. Sticky and persisted in the chat store, applied to
  // every turn; defaults to "Rotted". Edited via the RotLevelSheet below.
  const rotLevel = useChatStore((s) => s.rotLevel);
  const setRotLevel = useChatStore((s) => s.setRotLevel);
  const hydrateSession = useChatStore((s) => s.hydrateSession);
  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const streamingMeme = useChatStore((s) => s.streamingMeme);
  const activeReplyClientId = useChatStore((s) => s.activeReplyClientId);
  const settledReply = useChatStore((s) => s.settledReply);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const quota = useChatStore((s) => s.quota);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const rateMessage = useChatStore((s) => s.rateMessage);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const startNewConversation = useChatStore((s) => s.startNewConversation);
  const cancelStreaming = useChatStore((s) => s.cancelStreaming);
  const dismissQuota = useChatStore((s) => s.dismissQuota);
  const entitlement = useEntitlementStore((s) => s.entitlement);
  const currentPlan = useDisplayPlan();
  const openPlan = useOpenPlan();
  const router = useRouter();

  // Collapse the monthly + daily windows into one picture so we can nudge at
  // 90% and hard-block the composer at 100% of whichever is binding.
  const usage = useMemo<UsageState | null>(() => {
    if (!entitlement) return null;
    return computeUsageState({
      plan: entitlement.plan,
      creditsRemaining: entitlement.creditsRemaining,
      monthlyCredits: entitlement.monthlyCredits,
      dailyCreditsUsed: entitlement.dailyCreditsUsed,
      softDailyCredits: entitlement.softDailyCredits,
      creditsResetAt: entitlement.creditsResetAt,
      dailyResetAt: entitlement.dailyResetAt,
    });
  }, [entitlement]);

  const atLimit = usage?.atLimit ?? false;
  const nearLimit = (usage?.nearLimit ?? false) && !atLimit;
  // Top tier has nothing to upgrade to — the CTA becomes "See limits" instead.
  const isTopTier = currentPlan === "power";

  // Until the entitlement snapshot lands we don't know whether to show the
  // composer or the upgrade block — rendering either would flicker (chat bar
  // → upgrade). And when opening an existing conversation, messages are empty
  // until the first snapshot arrives. In both cases we show the playful
  // loader and fade the real content in only once we can compute it.
  const entitlementReady = entitlement !== null;
  const conversationLoading =
    conversationId !== null && messages.length === 0 && status !== "streaming";
  const areaLoading = !entitlementReady || conversationLoading;
  // "New conversation" only means something when there's a session or messages
  // to clear. On an already-blank new chat there's nothing to start, so the
  // button is hidden (and fades back in once a session loads).
  const canStartNew = conversationId !== null || messages.length > 0;

  useEffect(() => {
    const id = Array.isArray(params.conversationId)
      ? params.conversationId[0]
      : params.conversationId;

    if (id && id !== conversationId) {
      loadConversation(id);
    }
  }, [conversationId, loadConversation, params.conversationId]);

  // On app open, restore the sticky rot level and re-open the last session.
  // Runs once: a deep-linked conversation (route param) takes precedence, so in
  // that case we only restore the rot level and let the effect above load the
  // requested conversation.
  const sessionHydrated = useRef(false);
  useEffect(() => {
    if (sessionHydrated.current) return;
    sessionHydrated.current = true;
    const routeId = Array.isArray(params.conversationId)
      ? params.conversationId[0]
      : params.conversationId;
    void hydrateSession({ autoLoadConversation: !routeId });
  }, [hydrateSession, params.conversationId]);

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "user"),
    [messages],
  );

  // Loading label shown while a reply is in flight. We pick one of the playful
  // phrases at random, but lock it in for the duration of a given reply
  // (keyed on activeReplyClientId) so it doesn't reshuffle on every re-render.
  const pickLoadingMessage = useCallback(() => {
    const options = t("chat.loadingMessages", {
      returnObjects: true,
    }) as string[];
    if (!Array.isArray(options) || options.length === 0) {
      return t("chat.thinking");
    }
    return options[Math.floor(Math.random() * options.length)];
  }, [t]);
  const [thinkingLabel, setThinkingLabel] = useState(pickLoadingMessage);
  useEffect(() => {
    if (activeReplyClientId) {
      setThinkingLabel(pickLoadingMessage());
    }
  }, [activeReplyClientId, pickLoadingMessage]);

  const visibleMessages = useMemo<RenderMessage[]>(() => {
    // Drop empty placeholders, but keep errored agent bubbles so the user
    // sees the failure state.
    const base: RenderMessage[] = messages
      .filter(
        (message) =>
          message.text.length > 0 ||
          (message.images?.length ?? 0) > 0 ||
          (message.role === "agent" && message.status === "error"),
      )
      .map((message) => ({ ...message }));

    if (status === "streaming" && activeReplyClientId) {
      // The in-flight agent reply. We give it a STABLE id tied to the user
      // turn it answers, identical to the key the finalized Firestore
      // message resolves to (see `messageKey`). That continuity is what
      // stops the bubble from unmounting + replaying its entrance animation
      // when the stream finishes. Empty text → the pulsating "Memeing…"
      // indicator.
      base.push({
        id: `agent:${activeReplyClientId}`,
        role: "agent",
        inReplyToClientMessageId: activeReplyClientId,
        text: streamingText,
        images: streamingMeme ? [streamingMeme] : undefined,
        status: "streaming",
        createdAt: null,
        // Still "thinking" only when there's neither text nor a meme yet.
        thinking: streamingText.length === 0 && !streamingMeme,
      });
    } else if (settledReply) {
      // Bridge: the stream is done but the finalized Firestore message
      // hasn't arrived in the snapshot yet. Only synthesize it if the real
      // one isn't already present, so we never double-render.
      const alreadyStored = base.some(
        (message) =>
          message.role === "agent" &&
          message.inReplyToClientMessageId === settledReply.clientMessageId &&
          (message.text.length > 0 || (message.images?.length ?? 0) > 0),
      );
      if (!alreadyStored) {
        base.push({
          id: `agent:${settledReply.clientMessageId}`,
          role: "agent",
          inReplyToClientMessageId: settledReply.clientMessageId,
          text: settledReply.text,
          images: settledReply.images,
          status: "complete",
          createdAt: null,
        });
      }
    }

    // A failed turn surfaces as a single agent-side error card answering the
    // last user message — carrying both the explanation and the retry action,
    // so the failure reads as one coherent reply from Brainrot Bot. Skipped if the
    // backend already persisted an agent error reply for this turn.
    if (status === "error" && lastUserMessage) {
      const alreadyErrored = base.some(
        (message) => message.role === "agent" && message.status === "error",
      );
      if (!alreadyErrored) {
        base.push({
          id: `agent-error:${lastUserMessage.id}`,
          role: "agent",
          inReplyToClientMessageId: lastUserMessage.clientMessageId,
          text: "",
          status: "error",
          createdAt: null,
          errorKind: error === "signed-out" ? "signed-out" : "generic",
          retry: error !== "signed-out",
        });
      }
    }

    return base.reverse();
  }, [
    activeReplyClientId,
    error,
    lastUserMessage,
    messages,
    settledReply,
    status,
    streamingText,
    streamingMeme,
  ]);

  const handleSubmit = () => {
    if (atLimit) return;
    const text = draft.trim();
    const images = stagedImages;
    // Allow text-only, image-only, or text + images.
    if (text.length === 0 && images.length === 0) return;
    // Clear the composer optimistically (mirrors text-draft behavior). The
    // attachments ride along on the optimistic user bubble, and the error
    // card's retry resends them, so a failed send never loses them.
    setDraft("");
    setStagedImages([]);
    void sendMessage(text, images, rotLevel);
  };

  const handleStarterPress = (text: string) => {
    if (atLimit) return;
    setDraft("");
    void sendMessage(text, undefined, rotLevel);
  };

  const handleRetry = () => {
    if (!lastUserMessage) return;
    // Resend the failed turn's attachments too, so a meme isn't dropped on
    // retry. Reuse the level the original turn carried, falling back to the
    // current dial if it predates the feature.
    void sendMessage(
      lastUserMessage.text,
      lastUserMessage.images,
      lastUserMessage.levelOfRot ?? rotLevel,
    );
  };

  // Toggle the meme strip. The hook's `enabled` flag (wired to memesOpen) is
  // what triggers the first fetch, so this just flips visibility.
  const handleToggleMemes = () => {
    setMemesOpen((open) => !open);
  };

  const flashMaxNotice = useCallback(() => {
    setMaxNotice(true);
    if (maxNoticeTimer.current) clearTimeout(maxNoticeTimer.current);
    maxNoticeTimer.current = setTimeout(() => setMaxNotice(false), 2400);
  }, []);

  useEffect(
    () => () => {
      if (maxNoticeTimer.current) clearTimeout(maxNoticeTimer.current);
    },
    [],
  );

  // Tapping a meme stages it as an attachment (no URL is inserted into the
  // draft). Deduped by id; capped at MAX_MESSAGE_IMAGES with localized feedback.
  const handleSelectMeme = (meme: TrendingMeme) => {
    setStagedImages((current) => {
      if (current.some((image) => image.id === meme.id)) return current;
      if (current.length >= MAX_MESSAGE_IMAGES) {
        flashMaxNotice();
        return current;
      }
      return [...current, trendingMemeToMessageImage(meme)];
    });
  };

  const handleRemoveStagedImage = (id: string) => {
    setStagedImages((current) => current.filter((image) => image.id !== id));
  };

  // Drives the cross-fade when starting a new chat: fade the current thread
  // out, swap in the fresh empty state, then fade that back in.
  const contentOpacity = useSharedValue(1);
  const contentFadeStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  // Shared scroll offset + re-measure signal for the page-level bubble
  // gradient (see BubbleGradientContext). The handler runs on the UI thread so
  // the gradient tracks scrolling smoothly; the tick nudges bubbles to
  // re-anchor whenever the layout settles.
  const pageScrollY = useSharedValue(0);
  const [gradientTick, setGradientTick] = useState(0);
  const bumpGradient = useCallback(() => setGradientTick((t) => t + 1), []);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      pageScrollY.value = event.contentOffset.y;
    },
  });
  const bubbleGradient = useMemo(
    () => ({ scrollY: pageScrollY, measureTick: gradientTick }),
    [pageScrollY, gradientTick],
  );

  const handleNewConversation = () => {
    const reset = () => {
      startNewConversation();
      setStagedImages([]);
      // Clear any conversationId route param so the load effect doesn't
      // immediately re-hydrate the conversation we just cleared.
      if (params.conversationId) {
        router.setParams({ conversationId: "" });
      }
    };

    contentOpacity.value = withTiming(0, { duration: 160 });
    // Swap content at the trough of the fade, then fade the empty state in.
    setTimeout(() => {
      reset();
      contentOpacity.value = withTiming(1, { duration: 240 });
    }, 170);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme["--color-background"] }}
    >
      <AppHeader
        title={t("chat.title")}
        right={
          canStartNew ? (
            <Animated.View entering={FadeIn.duration(220)}>
              <NewConversationButton
                label={t("chat.newConversation")}
                onPress={handleNewConversation}
              />
            </Animated.View>
          ) : undefined
        }
      />

      <BubbleGradientContext.Provider value={bubbleGradient}>
        <Animated.FlatList
          style={contentFadeStyle}
          inverted
          data={visibleMessages}
          keyExtractor={messageKey}
          keyboardShouldPersistTaps="handled"
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          onContentSizeChange={bumpGradient}
          onMomentumScrollEnd={bumpGradient}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent:
              visibleMessages.length === 0 ? "center" : "flex-start",
            paddingHorizontal: 18,
            paddingTop: 16,
            paddingBottom: 18,
            gap: 10,
          }}
          ListEmptyComponent={
            // The FlatList is `inverted`, which applies a vertical flip to ALL
            // its content — including this empty component. We counter it with
            // the inverse transform so it reads right-side up. While loading we
            // show the playful loader instead of the (premature) empty state.
            areaLoading ? (
              <ChatLoading label={t("chat.loading")} />
            ) : (
              <EmptyChatState
                onStarterPress={handleStarterPress}
                atLimit={atLimit}
              />
            )
          }
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              retryLabel={t("common.retry")}
              errorLabel={t("chat.errors.generic")}
              thinkingLabel={thinkingLabel}
              onRetry={handleRetry}
              onRate={rateMessage}
            />
          )}
        />
      </BubbleGradientContext.Provider>

      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        {!entitlementReady ? (
          // Don't render the composer OR the upgrade block until we know the
          // usage state — showing either would flicker into the other.
          <Animated.View
            entering={FadeIn.duration(220)}
            style={{
              height: 52,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MemeAvatar variant="loading" size={36} pulse />
          </Animated.View>
        ) : atLimit && usage ? (
          // 100% of the binding allowance is spent: the composer is replaced
          // by an upgrade prompt so the user can't keep typing into a wall.
          <Animated.View entering={FadeIn.duration(220)}>
            <UsageLimitBlock
              usage={usage}
              isTopTier={isTopTier}
              onUpgrade={openPlan}
            />
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn.duration(220)}>
            {nearLimit && usage ? (
              <UsageNudge
                usage={usage}
                isTopTier={isTopTier}
                onUpgrade={openPlan}
              />
            ) : null}
            {memesOpen ? (
              <View style={{ marginBottom: 8 }}>
                <TrendingMemeStrip
                  memes={klipy.memes}
                  loading={klipy.loading}
                  loadingMore={klipy.loadingMore}
                  error={klipy.error}
                  hasNext={klipy.hasNext}
                  mode={klipy.mode}
                  searching={klipy.searching}
                  query={klipy.query}
                  onChangeQuery={klipy.setQuery}
                  onClearSearch={klipy.clearSearch}
                  onEndReached={klipy.loadMore}
                  onRetry={klipy.retry}
                  onSelectMeme={handleSelectMeme}
                  labels={{
                    searchPlaceholder: t("chat.memes.searchPlaceholder"),
                    empty: t("chat.memes.empty"),
                    noResults: t("chat.memes.noResults"),
                    error: t("chat.memes.error"),
                    retry: t("chat.memes.retry"),
                  }}
                />
              </View>
            ) : null}
            <StagedAttachmentTray
              images={stagedImages}
              showMaxNotice={maxNotice}
              onRemove={handleRemoveStagedImage}
            />
            <ChatInput
              value={draft}
              onChangeText={setDraft}
              onSend={handleSubmit}
              onCancel={cancelStreaming}
              streaming={status === "streaming"}
              hasAttachments={stagedImages.length > 0}
              placeholder={t("chat.input.placeholder")}
              sendAccessibilityLabel={t("chat.send")}
              cancelAccessibilityLabel={t("chat.cancel")}
              expandAccessibilityLabel={t("chat.expand")}
              collapseAccessibilityLabel={t("chat.collapse")}
            />
            <View
              style={{
                marginTop: 8,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <MemeToggleButton
                label={t("chat.memes.button")}
                open={memesOpen}
                onPress={handleToggleMemes}
              />
              <RotLevelButton
                label={t("chat.rot.button")}
                level={rotLevel}
                onPress={() => rotSheetRef.current?.present()}
              />
            </View>
          </Animated.View>
        )}
      </View>

      <QuotaModal
        quota={quota}
        isTopTier={isTopTier}
        onUpgrade={openPlan}
        onDismiss={dismissQuota}
      />

      <RotLevelSheet ref={rotSheetRef} level={rotLevel} onChange={setRotLevel} />
    </KeyboardAvoidingView>
  );
}

// Playful loading state for the message area. Lives inside the inverted
// FlatList's ListEmptyComponent, so it carries the same counter-flip as the
// empty state to read right-side up.
function ChatLoading({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(260)}
      style={{
        transform: [{ scaleY: -1 }],
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        paddingVertical: 28,
      }}
    >
      <MemeAvatar variant="loading" size={88} pulse />
      <Typography
        variant="body"
        style={{
          color: theme["--color-foreground-muted"],
          textAlign: "center",
        }}
      >
        {label}
      </Typography>
    </Animated.View>
  );
}

// A soft highlight band sweeps left→right across the label on a loop. Each
// glyph warms from the muted base color up into the brand gradient (and lifts
// a hair) as the band passes over it, giving "Memeing…" a gentle, playful
// shimmer instead of dead static text. Built on Animated.Text directly because
// Reanimated needs a ref-forwarding host to push animated style updates to
// native — our Typography wrapper doesn't forward refs.
const SHIMMER_DURATION_MS = 1600;
const SHIMMER_BAND = 0.42; // fraction of the sweep that's "lit" at once
const SHIMMER_LIFT = 2; // px the brightest glyph rises

// Linear interpolate between two #RRGGBB hex colors on the JS thread, so each
// glyph's target brand hue is precomputed and the worklet only fades between
// the muted base and that target.
function lerpHex(a: string, b: string, t: number): string {
  const ai = parseInt(a.slice(1), 16);
  const bi = parseInt(b.slice(1), 16);
  const ar = (ai >> 16) & 255;
  const ag = (ai >> 8) & 255;
  const ab = ai & 255;
  const br = (bi >> 16) & 255;
  const bg = (bi >> 8) & 255;
  const bb = bi & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

function ShimmerChar({
  char,
  position,
  progress,
  baseColor,
  brightColor,
}: {
  char: string;
  position: number; // 0..1 across the label
  progress: SharedValue<number>;
  baseColor: string;
  brightColor: string;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    // Distance from the sweeping head, wrapped onto [-0.5, 0.5] so the band
    // re-enters seamlessly from the left each loop.
    let d = (((position - progress.value) % 1) + 1) % 1;
    if (d > 0.5) d -= 1;
    const closeness = Math.max(0, 1 - Math.abs(d) / SHIMMER_BAND);
    // smoothstep for a soft falloff at the band edges
    const eased = closeness * closeness * (3 - 2 * closeness);
    return {
      color: interpolateColor(eased, [0, 1], [baseColor, brightColor]),
      opacity: 0.5 + 0.5 * eased,
      transform: [{ translateY: -SHIMMER_LIFT * eased }],
    };
  });

  return (
    <Animated.Text
      style={[
        {
          fontFamily: "Poppins-Medium",
          fontSize: 14,
          lineHeight: 21,
          includeFontPadding: false,
          textAlignVertical: "center",
        },
        animatedStyle,
      ]}
    >
      {char}
    </Animated.Text>
  );
}

function ThinkingText({
  label,
  baseColor,
  gradient,
}: {
  label: string;
  baseColor: string;
  gradient: readonly string[];
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: SHIMMER_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false,
    );
  }, [progress]);

  const chars = useMemo(() => Array.from(label), [label]);
  const from = gradient[0] ?? baseColor;
  const to = gradient[gradient.length - 1] ?? from;

  return (
    <View style={{ flexDirection: "row", paddingTop: SHIMMER_LIFT }}>
      {chars.map((c, i) => (
        <ShimmerChar
          key={`${c}-${i}`}
          char={c}
          position={chars.length > 1 ? i / (chars.length - 1) : 0}
          progress={progress}
          baseColor={baseColor}
          // Spread the brand sweep across the glyphs so the lit band itself
          // reads as a gradient, not a single flat highlight color.
          brightColor={lerpHex(
            from,
            to,
            chars.length > 1 ? i / (chars.length - 1) : 0,
          )}
        />
      ))}
    </View>
  );
}

const STARTER_COUNT = 3;

// Fisher–Yates pick of n distinct items. Copies first so the source list
// isn't mutated.
function pickRandom<T>(items: T[], n: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function EmptyChatState({
  onStarterPress,
  atLimit,
}: {
  onStarterPress: (text: string) => void;
  atLimit: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const accentGradient = gradients[colorScheme ?? "light"].accent;
  // Randomize which starters appear each time the empty state mounts (new
  // conversation / fresh load), drawn from the full pool in the locale file.
  const starters = useMemo(() => {
    const pool = t("chat.starters.items", { returnObjects: true });
    if (!Array.isArray(pool)) return [];
    return pickRandom(pool as string[], STARTER_COUNT);
  }, [t]);

  // Pick a fresh title/subtitle pair each mount. The at-limit state has its
  // own fixed copy; the normal state draws one of the playful intros at random.
  const intro = useMemo<{ title: string; subtitle: string }>(() => {
    if (atLimit) {
      return {
        title: t("chat.empty.atTitle"),
        subtitle: t("chat.empty.atSubtitle"),
      };
    }
    const pool = t("chat.empty.intros", { returnObjects: true });
    if (!Array.isArray(pool) || pool.length === 0) {
      return { title: "", subtitle: "" };
    }
    return pool[Math.floor(Math.random() * pool.length)] as {
      title: string;
      subtitle: string;
    };
  }, [t, atLimit]);

  // Entrance for the whole empty state. Plays once when this mounts — i.e. the
  // moment the loader clears and Brainrot Bot "wakes up". A soft opacity fade paired
  // with a gentle spring scale so it eases in instead of hard-blinking. The
  // animated transform lives on an inner view so it doesn't disturb the
  // outer scaleY:-1 counter-flip the inverted FlatList requires.
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.92);

  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });
    scale.value = withSpring(1, { damping: 13, stiffness: 170, mass: 0.85 });
  }, [opacity, scale]);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View
      style={{
        transform: [{ scaleY: -1 }],
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 6,
        paddingVertical: 28,
      }}
    >
      <Animated.View
        style={[
          {
            alignItems: "center",
            gap: 12,
            width: "100%",
            maxWidth: 420,
          },
          entranceStyle,
        ]}
      >
        <View
          style={{
            width: 104,
            height: 104,
            borderRadius: 52,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme["--color-primary-subtle"],
          }}
        >
          <AgentAvatar size={84} pulse />
        </View>

        <View style={{ alignItems: "center", gap: 6 }}>
          <Typography
            variant="title-xl"
            style={{ color: theme["--color-foreground"], textAlign: "center" }}
          >
            {intro.title}
          </Typography>
          <Typography
            variant="body"
            style={{
              color: theme["--color-foreground-muted"],
              textAlign: "center",
              maxWidth: 330,
            }}
          >
            {intro.subtitle}
          </Typography>
        </View>

        {!atLimit ? (
          <View
            style={{
              width: "100%",
              gap: 10,
              marginTop: 8,
            }}
          >
            {starters.map((starter, index) => (
              <StarterPrompt
                key={starter}
                text={starter}
                index={index}
                onPress={onStarterPress}
              />
            ))}
          </View>
        ) : null}

        <View
          pointerEvents="none"
          style={{
            width: 138,
            height: 4,
            borderRadius: 99,
            overflow: "hidden",
            marginTop: 2,
            opacity: 0.8,
          }}
        >
          <LinearGradient
            colors={accentGradient.colors}
            start={accentGradient.start}
            end={accentGradient.end}
            style={StyleSheet.absoluteFillObject}
          />
        </View>
      </Animated.View>
    </View>
  );
}

function StarterPrompt({
  text,
  index,
  onPress,
}: {
  text: string;
  index: number;
  onPress: (text: string) => void;
}) {
  const theme = useTheme();
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    if (pressed.value === 1) return;
    pressed.value = 1;
    scale.value = withTiming(0.96, { duration: 90 });
    opacity.value = withTiming(0, { duration: 180 }, (finished) => {
      if (finished) {
        runOnJS(onPress)(text);
      }
    });
  };

  return (
    <Animated.View style={[{ width: "100%" }, animatedStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text}
        onPress={handlePress}
        style={({ pressed: isPressed }) => ({
          minHeight: 52,
          borderRadius: 16,
          paddingHorizontal: 16,
          paddingVertical: 14,
          justifyContent: "center",
          backgroundColor: isPressed
            ? theme["--color-card-pressed"]
            : theme["--color-card"],
          borderWidth: 1,
          borderColor:
            index % 2 === 0
              ? theme["--color-border"]
              : theme["--color-primary-muted"],
          shadowColor: "#000000",
          shadowOpacity: 0.08,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 5 },
          elevation: 2,
        })}
      >
        <Typography
          variant="body-sm"
          weight="semibold"
          style={{ color: theme["--color-foreground"], textAlign: "center" }}
        >
          {text}
        </Typography>
      </Pressable>
    </Animated.View>
  );
}

// Gradient CTA shared by the quota modal + usage block. Label flips to
// "See limits" on the top tier, where there's nothing left to upgrade to.
function UpgradeButton({
  isTopTier,
  onPress,
  height = 52,
}: {
  isTopTier: boolean;
  onPress: () => void;
  height?: number;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;
  const label = isTopTier ? t("chat.usage.seeLimits") : t("chat.usage.upgrade");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        height,
        borderRadius: height / 2,
        overflow: "hidden",
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <LinearGradient
        colors={gradient.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Typography
          variant="title-sm"
          style={{ color: "#FFFFFF", fontWeight: "800" }}
        >
          {label}
        </Typography>
      </View>
    </Pressable>
  );
}

// Inline 90% nudge above the composer. Cute, compact, dismissible — a single
// tap takes the user to Plan & Usage.
function UsageNudge({
  usage,
  isTopTier,
  onUpgrade,
}: {
  usage: UsageState;
  isTopTier: boolean;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [dismissed, setDismissed] = useState(false);
  const when = useResetCountdown(usage.bindingResetAt);

  if (dismissed) return null;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 8,
        padding: 12,
        borderRadius: 16,
        backgroundColor: theme["--color-warning-muted"],
        borderWidth: 1,
        borderColor: theme["--color-warning"],
      }}
    >
      <MemeAvatar variant="worried" size={40} />
      <View style={{ flex: 1 }}>
        <Typography
          variant="body-sm"
          weight="semibold"
          style={{ color: theme["--color-foreground"] }}
        >
          {t("chat.usage.nearTitle")}
        </Typography>
        <Typography
          variant="caption"
          style={{ color: theme["--color-foreground-secondary"], marginTop: 1 }}
        >
          {t("chat.usage.nearBody", {
            percent: usage.bindingPercentLeft,
            when,
          })}
        </Typography>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isTopTier ? t("chat.usage.seeLimits") : t("chat.usage.upgrade")
        }
        onPress={onUpgrade}
        hitSlop={6}
        style={({ pressed }) => ({
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: theme["--color-primary"],
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Typography
          variant="caption"
          style={{
            color: theme["--color-primary-foreground"],
            fontWeight: "800",
          }}
        >
          {isTopTier ? t("chat.usage.seeLimits") : t("chat.usage.upgrade")}
        </Typography>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("chat.usage.dismiss")}
        onPress={() => setDismissed(true)}
        hitSlop={8}
        style={{ paddingLeft: 2 }}
      >
        <X size={16} color={theme["--color-foreground-muted"]} weight="bold" />
      </Pressable>
    </View>
  );
}

// 100% block that replaces the composer. Typing into a spent allowance does
// nothing, so we trade the input for a clear upgrade path.
function UsageLimitBlock({
  usage,
  isTopTier,
  onUpgrade,
}: {
  usage: UsageState;
  isTopTier: boolean;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const when = useResetCountdown(usage.bindingResetAt);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: 14,
        borderRadius: 20,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
      }}
    >
      <MemeAvatar variant="worried" size={48} pulse />
      <View style={{ flex: 1, gap: 8 }}>
        <View>
          <Typography
            variant="body"
            weight="semibold"
            style={{ color: theme["--color-foreground"] }}
          >
            {t("chat.usage.atTitle")}
          </Typography>
          <Typography
            variant="caption"
            style={{
              color: theme["--color-foreground-secondary"],
              marginTop: 1,
            }}
          >
            {t("chat.usage.atBody", { when })}
          </Typography>
        </View>
        <UpgradeButton isTopTier={isTopTier} onPress={onUpgrade} height={44} />
      </View>
    </View>
  );
}

function QuotaModal({
  quota,
  isTopTier,
  onUpgrade,
  onDismiss,
}: {
  quota: QuotaInfo | null;
  isTopTier: boolean;
  onUpgrade: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const visible = quota !== null;

  const dateLabel = useMemo(() => {
    if (!quota?.resetAt) return t("common.reset.soon");
    const parsed = new Date(quota.resetAt);
    if (Number.isNaN(parsed.getTime())) return t("common.reset.soon");
    return formatResetMoment(parsed, Date.now(), t);
  }, [quota?.resetAt, t]);

  // `reason` mirrors the server's QuotaReason discriminator (see
  // functions/src/billing/ledger.ts). Each branch picks a tailored copy
  // string; unknown reasons fall back to the monthly message.
  const body = useMemo(() => {
    switch (quota?.reason) {
      case "daily":
        return t("chat.quota.daily", { date: dateLabel });
      default:
        return t("chat.quota.monthly", { date: dateLabel });
    }
  }, [quota?.reason, dateLabel, t]);

  const handleUpgrade = () => {
    onDismiss();

    setTimeout(() => {
      onUpgrade();
    }, 300);
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
      >
        <View
          style={{
            backgroundColor: theme["--color-card"],
            borderRadius: 24,
            paddingHorizontal: 22,
            paddingTop: 24,
            paddingBottom: 18,
            gap: 14,
            alignItems: "center",
          }}
        >
          <MemeAvatar variant="worried" size={92} pulse />
          <Typography
            variant="title-md"
            style={{
              color: theme["--color-foreground"],
              fontWeight: "800",
              textAlign: "center",
            }}
          >
            {t("chat.quota.title")}
          </Typography>
          <Typography
            variant="body"
            style={{
              color: theme["--color-foreground-secondary"],
              textAlign: "center",
            }}
          >
            {body}
          </Typography>

          <View style={{ width: "100%", gap: 8, marginTop: 2 }}>
            <UpgradeButton isTopTier={isTopTier} onPress={handleUpgrade} />
            <Pressable
              accessibilityRole="button"
              onPress={onDismiss}
              style={{
                alignItems: "center",
                paddingVertical: 10,
                borderRadius: 10,
              }}
            >
              <Typography
                variant="body"
                style={{
                  color: theme["--color-foreground-muted"],
                  fontWeight: "600",
                }}
              >
                {t("chat.quota.dismiss")}
              </Typography>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Visual constants for the bubble layout. iMessage-style asymmetric
// corners: a single corner on the sender's side is squared off (smaller
// radius) to read as the "tail" pointing at the speaker.
const BUBBLE_RADIUS = 20;
const BUBBLE_TAIL_RADIUS = 6;
const AVATAR_SIZE = 36;
const AVATAR_GUTTER = 10;

function formatMessageTimestamp(value?: Date | null): string | null {
  if (!value) return null;
  const timestampMs = value.getTime();
  if (Number.isNaN(timestampMs)) return null;

  const now = new Date();
  const sameYear = value.getFullYear() === now.getFullYear();
  const sameDay = value.toDateString() === now.toDateString();
  const time = value.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sameDay) return time;

  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

function MessageBubble({
  message,
  retryLabel,
  errorLabel,
  thinkingLabel,
  onRetry,
  onRate,
}: {
  message: RenderMessage;
  retryLabel: string;
  errorLabel: string;
  thinkingLabel: string;
  onRetry: () => void;
  onRate: (serverId: string, reaction: MessageReaction) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const primaryGradient = gradients[colorScheme ?? "light"].primary;
  const mine = message.role === "user";
  const errored = message.status === "error";
  const isErrorCard = message.role === "agent" && errored;
  const thinking = message.thinking === true;
  const useGradient = mine && !errored;
  const timestampLabel = formatMessageTimestamp(message.createdAt);
  const [showTimestamp, setShowTimestamp] = useState(false);

  // Agent replies may carry meme markdown/attachment artifacts (stripped on the
  // backend now, but older stored messages and the live stream still need it).
  const rawText =
    errored && message.text.length === 0 ? errorLabel : message.text;
  const messageText =
    message.role === "agent" ? stripMemeArtifacts(rawText) : rawText;

  // A user turn may carry staged/persisted Klipy memes. Render the images, and
  // only render the text bubble when there's actual text (or the streaming
  // "thinking" placeholder) — so an image-only turn shows just the image.
  const messageImages = message.images ?? [];
  const hasImages = messageImages.length > 0;
  const hasTextBubble = message.thinking === true || messageText.length > 0;

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
    ? theme["--color-primary-foreground"]
    : errored
      ? theme["--color-error"]
      : theme["--color-foreground"];

  const mutedMessageColor = mine
    ? theme["--color-primary-foreground"]
    : theme["--color-foreground-muted"];

  const codeBackgroundColor = mine
    ? "rgba(255,255,255,0.18)"
    : theme["--color-background-secondary"];

  const borderColor = mine ? "rgba(255,255,255,0.24)" : theme["--color-border"];

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

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
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

  const measureTick = bubbleGradient?.measureTick;
  useEffect(() => {
    if (useGradient) remeasureGradient();
  }, [useGradient, remeasureGradient, measureTick]);

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
  const bubbleBg = useGradient
    ? "transparent"
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
    // Reserve avatar-width gutter on user messages too, so left/right
    // alignment stays mirrored across the visual axis.
    paddingLeft: mine ? AVATAR_SIZE + AVATAR_GUTTER : 0,
    paddingRight: mine ? 0 : AVATAR_SIZE + AVATAR_GUTTER,
  };

  // Failed turn: a self-contained agent card with the worried mascot, a
  // headline + explanation, and the retry action all in one place — instead
  // of a bare error bubble plus a stray "try again" pill under the user's
  // message.
  if (isErrorCard) {
    const signedOut = message.errorKind === "signed-out";
    const errorTitle = signedOut
      ? t("chat.errors.signedOutTitle")
      : t("chat.errors.title");
    const errorBody = signedOut
      ? t("chat.errors.signedOut")
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
      <View style={rowStyle}>
        {!mine ? (
          // Avatar lives outside the bubble, top-aligned with it. For the
          // "thinking" indicator the avatar pulses.
          <View style={{ marginRight: AVATAR_GUTTER, paddingTop: 2 }}>
            <AgentAvatar size={AVATAR_SIZE} pulse={thinking} />
          </View>
        ) : null}

        <View
          style={{
            flexShrink: 1,
            maxWidth: "100%",
            alignItems: mine ? "flex-end" : "flex-start",
            gap: 6,
          }}
        >
          {hasImages ? (
            <MessageImageAttachments
              images={messageImages}
              align={mine ? "end" : "start"}
              imageLabel={t("chat.attachments.imageLabel")}
            />
          ) : null}

          {hasTextBubble ? (
            <Pressable
              ref={bubbleRef}
              onLayout={useGradient ? remeasureGradient : undefined}
              accessibilityRole="button"
              accessibilityLabel={
                timestampLabel
                  ? `${messageText}. ${timestampLabel}`
                  : messageText
              }
              onLongPress={() => {
                if (timestampLabel) setShowTimestamp((current) => !current);
              }}
              onPress={() => {
                if (showTimestamp) setShowTimestamp(false);
              }}
              delayLongPress={260}
              style={({ pressed }) => ({
                maxWidth: "100%",
                borderRadius: BUBBLE_RADIUS,
                ...cornerStyle,
                paddingHorizontal: 14,
                paddingVertical: 10,
                overflow: "hidden",
                backgroundColor: bubbleBg,
                opacity: pressed && timestampLabel ? 0.88 : 1,
              })}
            >
              {useGradient ? (
                // One screen-tall gradient, slid so the slice behind this bubble
                // matches its place on the page. `overflow: hidden` on the
                // Pressable masks it to the bubble shape.
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
                    colors={primaryGradient.colors}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={{ width: "100%", height: windowHeight }}
                  />
                </Animated.View>
              ) : null}
              {thinking ? (
                <ThinkingText
                  label={thinkingLabel}
                  baseColor={theme["--color-foreground-muted"]}
                  gradient={primaryGradient.colors}
                />
              ) : shouldRenderMarkdown(messageText) ? (
                <Markdown style={markdownStyles}>{messageText}</Markdown>
              ) : (
                <Typography
                  variant="body"
                  style={{
                    color: messageColor,
                    fontSize: 17,
                    lineHeight: 24,
                  }}
                >
                  {messageText}
                </Typography>
              )}
            </Pressable>
          ) : null}

          {showActions && message.serverId ? (
            <MessageActions
              text={messageText}
              reaction={message.reaction}
              onRate={(reaction) => onRate(message.serverId!, reaction)}
              labels={{
                copy: t("chat.actions.copy"),
                copied: t("chat.actions.copied"),
                up: t("chat.actions.thumbsUp"),
                down: t("chat.actions.thumbsDown"),
              }}
            />
          ) : null}
        </View>
      </View>

      {showTimestamp && timestampLabel ? (
        <View
          style={{
            paddingLeft: AVATAR_SIZE + AVATAR_GUTTER,
            paddingRight: mine ? 0 : AVATAR_SIZE + AVATAR_GUTTER,
            alignItems: mine ? "flex-end" : "flex-start",
          }}
        >
          <Typography
            variant="micro"
            style={{ color: theme["--color-foreground-muted"] }}
          >
            {timestampLabel}
          </Typography>
        </View>
      ) : null}
    </Animated.View>
  );
}
