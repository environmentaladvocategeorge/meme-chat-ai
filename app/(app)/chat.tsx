import { AdBanner } from "@/components/ads/AdBanner";
import { AppHeader } from "@/components/AppHeader";
import { AppKeyboardAvoidingView } from "@/components/AppKeyboardAvoidingView";
import { AttachmentViewerProvider } from "@/components/AttachmentViewer";
import { ChatInput, type ChatInputRef } from "@/components/ChatInput";
import { buildVisibleMessages } from "@/components/chat/buildVisibleMessages";
import {
  BubbleGradientContext,
  shouldBumpOnContentSizeChange,
  type BubbleGradientValue,
} from "@/components/chat/BubbleGradientContext";
import { ThinkingLabelContext } from "@/components/chat/ThinkingLabelContext";
import { ChatLoading } from "@/components/chat/ChatLoading";
import { CollapsiblePicker } from "@/components/chat/CollapsiblePicker";
import {
  GifToggleButton,
  MemeToggleButton,
  PhotoButton,
  RotLevelButton,
} from "@/components/chat/ComposerToggles";
import { EdgeFadedScrollRow } from "@/components/chat/EdgeFadedScrollRow";
import { EmptyChatState } from "@/components/chat/EmptyChatState";
import { MemoryOnBanner } from "@/components/chat/MemoryOnBanner";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { NewConversationButton } from "@/components/chat/NewConversationButton";
import {
  anyPickerOpen,
  dismissPickers,
  toggleGifs,
  toggleMemes,
  type PickerVisibility,
} from "@/components/chat/pickerVisibility";
import { QuotaModal } from "@/components/chat/QuotaModal";
import { StagedAttachmentTray } from "@/components/chat/StagedAttachmentTray";
import { messageKey, type RenderMessage } from "@/components/chat/types";
import { UsageLimitBlock, UsageNudge } from "@/components/chat/UsageNotices";
import { ComposerSkeleton } from "@/components/chat/ComposerSkeleton";
import { ScrollToBottomButton } from "@/components/chat/ScrollToBottomButton";
import { TrendingMemeStrip } from "@/components/TrendingMemeStrip";
import {
  trendingGifToMessageGif,
  type MessageGif,
  type TrendingGif,
} from "@/domain/gifs";
import {
  MAX_MESSAGE_IMAGES,
  trendingMemeToMessageImage,
  type MessageImage,
  type TrendingMeme,
} from "@/domain/memes";
import { computeUsageState, type UsageState } from "@/domain/usage";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { useKlipy } from "@/hooks/useKlipy";
import { useKlipyGifs } from "@/hooks/useKlipyGifs";
import { useOnSendEffects } from "@/hooks/useOnSendEffects";
import { useMemoryMeta } from "@/hooks/useMemory";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { ChatToneContext } from "@/hooks/useTheme";
import { PLAN_RANK } from "@/domain/billing";
import { withAlpha } from "@/domain/customization";
import { useChatStore } from "@/store/chat";
import { useDisplayPlan, useEntitlementStore } from "@/store/entitlement";
import { useMemorySheetStore } from "@/store/memorySheet";
import { useRotLevelSheetStore } from "@/store/rotLevelSheet";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  captureAndUploadImage,
  CaptureImageError,
  type PickSource,
} from "@/services/firebase/uploadMessageImage";
import Animated, {
  FadeIn,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Height of the gradient ramp above the floating composer dock — the zone
// where scrolling messages dissolve into the backdrop instead of hard-cutting.
const DOCK_FADE_HEIGHT = 32;
// Matching (smaller) ramp at the top of the thread, so messages dissolve just
// before they touch the header instead of cutting at the viewport edge.
const HEADER_FADE_HEIGHT = 20;

export default function ChatScreen() {
  const { t } = useTranslation();
  // Fires daily paywall check + review prompt counter on each message send.
  useOnSendEffects();

  // The chat view's theme follows the custom background's tone (so every
  // element coheres with it), falling back to the global scheme when "auto".
  const {
    background: chatBackground,
    themeContext: chatThemeContext,
    chatTheme: theme,
  } = useChatAppearance();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const [draft, setDraft] = useState("");
  // Measured height of the floating composer dock. The message list scrolls
  // edge-to-edge behind the dock; this feeds the list's bottom inset so
  // resting content sits above it and only scrolls under it.
  const [dockHeight, setDockHeight] = useState(0);
  const [memesOpen, setMemesOpen] = useState(false);
  const [gifsOpen, setGifsOpen] = useState(false);
  const chatInputRef = useRef<ChatInputRef>(null);
  // Thread list ref — jump-to-latest button and the send path both scroll
  // the inverted list back to offset 0 (the visual bottom).
  const listRef = useRef<FlatList<RenderMessage>>(null);
  const newConvoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Memes the user has staged but not yet sent. Sent as multimodal image
  // inputs; capped at MAX_MESSAGE_IMAGES (the backend re-enforces the cap).
  const [stagedImages, setStagedImages] = useState<MessageImage[]>([]);
  // The single GIF the user has staged but not yet sent. Independent of the
  // meme cap — a turn may carry memes AND one GIF.
  const [stagedGif, setStagedGif] = useState<MessageGif | null>(null);
  // True while a captured/picked photo is being compressed + uploaded to
  // Storage, so the photo button can show a spinner and block re-taps.
  const [uploadingImage, setUploadingImage] = useState(false);
  // Brief "you can only attach N" notice, shown when a 4th meme is tapped.
  const [maxNotice, setMaxNotice] = useState(false);
  const maxNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Memes for the composer strip (trending + debounced KLIPY search). Modular —
  // the same hook can power a meme picker anywhere else in the app. `enabled`
  // defers the first network call until the strip is actually opened.
  const klipy = useKlipy({ perPage: 24, enabled: memesOpen });
  // GIFs for the composer strip — same engine, GIF endpoints. Deferred until the
  // GIF drawer is opened.
  const klipyGifs = useKlipyGifs({ perPage: 24, enabled: gifsOpen });
  const conversationId = useChatStore((s) => s.conversationId);
  // Brainrot intensity dial. Sticky and persisted in the chat store, applied to
  // every turn; defaults to "Rotted". Edited via the RotLevelSheet (mounted in
  // the root layout, opened here through useRotLevelSheetStore).
  const rotLevel = useChatStore((s) => s.rotLevel);
  const openRotSheet = useRotLevelSheetStore((s) => s.open);
  const hydrateSession = useChatStore((s) => s.hydrateSession);
  const messages = useChatStore((s) => s.messages);
  // NOTE: deliberately NOT subscribed to streamingText/streamingMeme/
  // streamingGif — the streaming bubble pulls those itself (MessageBubble), so
  // delta flushes don't re-render the screen or rebuild the list.
  const olderMessages = useChatStore((s) => s.olderMessages);
  const loadingOlder = useChatStore((s) => s.loadingOlder);
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);
  const activeReplyClientId = useChatStore((s) => s.activeReplyClientId);
  const settledReply = useChatStore((s) => s.settledReply);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const quota = useChatStore((s) => s.quota);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const rateMessage = useChatStore((s) => s.rateMessage);
  const setMessageEmoji = useChatStore((s) => s.setMessageEmoji);
  const replayTurn = useChatStore((s) => s.replayTurn);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const startNewConversation = useChatStore((s) => s.startNewConversation);
  const cancelStreaming = useChatStore((s) => s.cancelStreaming);
  const dismissQuota = useChatStore((s) => s.dismissQuota);
  const entitlement = useEntitlementStore((s) => s.entitlement);
  const currentPlan = useDisplayPlan();
  const openPlan = useOpenPlan();
  const openMemorySheet = useMemorySheetStore((s) => s.open);
  const { meta: memoryMeta } = useMemoryMeta();
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

  // Subtle "Memory is on" hint, only on a fresh chat. Paid + memory-enabled
  // only; when memory is off we show nothing, so the hint's presence always
  // means it's on. Tapping it opens the Memory sheet to review or switch off.
  const showMemoryBanner =
    entitlementReady &&
    !canStartNew &&
    PLAN_RANK[currentPlan] > PLAN_RANK.free &&
    memoryMeta.enabled;

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

  // Rendered thread = static paginated prefix (older pages, oldest-first) +
  // the live snapshot tail. All optimistic/settled/streaming logic operates on
  // the tail only (in the store); this is the single place they're joined.
  const allMessages = useMemo(
    () =>
      olderMessages.length === 0 ? messages : [...olderMessages, ...messages],
    [olderMessages, messages],
  );

  const lastUserMessage = useMemo(() => {
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].role === "user") return allMessages[i];
    }
    return undefined;
  }, [allMessages]);

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

  const visibleMessages = useMemo<RenderMessage[]>(
    () =>
      buildVisibleMessages({
        messages: allMessages,
        status,
        activeReplyClientId,
        settledReply,
        error,
        lastUserMessage,
      }),
    [
      activeReplyClientId,
      error,
      lastUserMessage,
      allMessages,
      settledReply,
      status,
    ],
  );

  // The most recent finalized agent reply is the only turn replay may
  // regenerate (replaying an older one would orphan everything after it). null
  // while none exists or while a turn is streaming, which hides the button.
  const lastAgentServerId = useMemo<string | null>(() => {
    if (status === "streaming") return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "agent" && m.status === "complete" && m.serverId) {
        return m.serverId;
      }
    }
    return null;
  }, [messages, status]);

  const handleSubmit = () => {
    if (atLimit) return;
    // Typing is allowed during a reply, sending is not. Guarded here (before
    // the draft is optimistically cleared — otherwise a bypassed send would
    // eat the message) and again inside sendMessage itself.
    if (useChatStore.getState().status === "streaming") return;
    const text = draft.trim();
    const images = stagedImages;
    const gif = stagedGif;
    // Allow text-only, attachment-only, or text + attachments.
    if (text.length === 0 && images.length === 0 && !gif) return;
    // Clear the composer optimistically (mirrors text-draft behavior). The
    // attachments ride along on the optimistic user bubble, and the error
    // card's retry resends them, so a failed send never loses them.
    setDraft("");
    setStagedImages([]);
    setStagedGif(null);
    // Collapse the pickers on send so they don't linger empty above a
    // freshly-cleared composer. The keyboard is intentionally left up (we
    // don't blur) so rapid follow-up messages stay frictionless.
    applyPickers(dismissPickers());
    void sendMessage(text, images, gif, rotLevel);
    // If the user sent from up in their history, glide back to the live
    // edge so the optimistic bubble (and the incoming reply) are in view.
    // Next frame, so the optimistic message has rendered before the scroll.
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  };

  // Tapping a starter chip drops its text into the composer and focuses it,
  // rather than firing the message off. The user can tweak it (or just hit
  // send), so a starter is a head-start, not an irreversible send.
  const handleStarterPress = (text: string) => {
    if (atLimit) return;
    setDraft(text);
    chatInputRef.current?.focus();
  };

  // Stable for the memoized bubbles (empty deps): the last user turn is
  // resolved from the store at press time, not closed over per render.
  const handleRetry = useCallback(() => {
    const state = useChatStore.getState();
    let lastUser = null;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === "user") {
        lastUser = state.messages[i];
        break;
      }
    }
    if (!lastUser) return;
    // Resend the failed turn's attachments too, so a meme/gif isn't dropped on
    // retry. Reuse the level the original turn carried, falling back to the
    // current dial if it predates the feature.
    void state.sendMessage(
      lastUser.text,
      lastUser.images,
      lastUser.gifs?.[0] ?? null,
      lastUser.levelOfRot ?? state.rotLevel,
    );
  }, []);

  // Apply a computed picker-visibility transition to the two backing flags.
  // The pure transitions in pickerVisibility.ts own the mutual-exclusion logic;
  // this just commits their result to state.
  const applyPickers = (next: PickerVisibility) => {
    setMemesOpen(next.memesOpen);
    setGifsOpen(next.gifsOpen);
  };

  // Toggle the meme strip. The hook's `enabled` flag (wired to memesOpen) is
  // what triggers the first fetch. The picker and the system keyboard occupy
  // the same conceptual slot, so we keep them mutually exclusive: opening the
  // strip dismisses the keyboard; closing it hands focus back to the composer
  // (which raises the keyboard) — a clean keyboard ⇄ memes swap.
  const handleToggleMemes = () => {
    const wasOpen = memesOpen;
    applyPickers(toggleMemes({ memesOpen, gifsOpen }));
    if (wasOpen) chatInputRef.current?.focus();
    else Keyboard.dismiss();
  };

  // Same keyboard ⇄ picker swap for the GIF drawer; opening it closes the meme
  // strip so only one picker is ever showing.
  const handleToggleGifs = () => {
    const wasOpen = gifsOpen;
    applyPickers(toggleGifs({ memesOpen, gifsOpen }));
    if (wasOpen) chatInputRef.current?.focus();
    else Keyboard.dismiss();
  };

  // Opening the Rot Level sheet: dismiss the keyboard first so the 46% sheet
  // doesn't animate up behind it (otherwise it lands occluded), and close both
  // pickers so only one bottom surface is ever showing.
  const handleOpenRot = () => {
    Keyboard.dismiss();
    applyPickers(dismissPickers());
    openRotSheet();
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

  // Tapping a GIF stages it (max one — a new pick replaces the current one).
  // Independent of the meme cap. Closes the GIF drawer so the staged thumbnail
  // is immediately visible above the composer.
  const handleSelectGif = (gif: TrendingGif) => {
    setStagedGif(trendingGifToMessageGif(gif));
    setGifsOpen(false);
  };

  const handleRemoveStagedGif = () => {
    setStagedGif(null);
  };

  // Capture or pick a photo, compress + upload it, and stage it as an upload
  // attachment. Deduped by the meme cap (uploads share MAX_MESSAGE_IMAGES with
  // Klipy memes); the backend re-enforces the cap.
  const stageUploadedPhoto = useCallback(
    async (source: PickSource) => {
      if (stagedImages.length >= MAX_MESSAGE_IMAGES) {
        flashMaxNotice();
        return;
      }
      setUploadingImage(true);
      try {
        const image = await captureAndUploadImage(source, conversationId);
        if (image) {
          setStagedImages((current) =>
            current.length >= MAX_MESSAGE_IMAGES
              ? current
              : [...current, image],
          );
        }
      } catch (err) {
        const code =
          err instanceof CaptureImageError ? err.code : "upload-failed";
        Alert.alert(
          t("chat.photo.errorTitle", { defaultValue: "Couldn't add photo" }),
          code === "permission-denied"
            ? t("chat.photo.permission", {
                defaultValue:
                  "Camera or photo access is required to add a photo.",
              })
            : t("chat.photo.failed", {
                defaultValue:
                  "Something went wrong adding your photo. Please try again.",
              }),
        );
      } finally {
        setUploadingImage(false);
      }
    },
    [conversationId, stagedImages.length, flashMaxNotice, t],
  );

  // Photo button → choose camera or library, then upload. Dismiss the keyboard
  // and any open picker first so the chooser/photo UI isn't fighting them.
  const handleAddPhoto = useCallback(() => {
    if (uploadingImage) return;
    Keyboard.dismiss();
    applyPickers(dismissPickers());
    Alert.alert(
      t("chat.photo.title", { defaultValue: "Add a photo" }),
      undefined,
      [
        {
          text: t("chat.photo.camera", { defaultValue: "Take Photo" }),
          onPress: () => void stageUploadedPhoto("camera"),
        },
        {
          text: t("chat.photo.library", {
            defaultValue: "Choose from Library",
          }),
          onPress: () => void stageUploadedPhoto("library"),
        },
        {
          text: t("common.cancel", { defaultValue: "Cancel" }),
          style: "cancel",
        },
      ],
    );
  }, [uploadingImage, stageUploadedPhoto, t]);

  // Drives the cross-fade when starting a new chat: fade the current thread
  // out, swap in the fresh empty state, then fade that back in.
  const contentOpacity = useSharedValue(1);
  const contentFadeStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  // Shared scroll offset + re-measure signal for the page-level bubble
  // gradient (see BubbleGradientContext). The handler runs on the UI thread so
  // the gradient tracks scrolling smoothly; the tick nudges bubbles to
  // re-anchor whenever the layout settles. Both are SharedValues, so a tick
  // re-renders nothing — the context value never changes identity and bubbles
  // react via useAnimatedReaction off the render path.
  const pageScrollY = useSharedValue(0);
  const measureTick = useSharedValue(0);
  const bumpGradient = useCallback(() => {
    measureTick.value += 1;
  }, [measureTick]);
  // Content-size ticks are gated off while streaming (the content height
  // changes on every delta flush); one bump fires on the streaming → idle /
  // error transition below instead. Status is read at call time so this
  // callback stays stable.
  const handleContentSizeChange = useCallback(() => {
    if (shouldBumpOnContentSizeChange(useChatStore.getState().status)) {
      bumpGradient();
    }
  }, [bumpGradient]);
  useEffect(() => {
    if (status !== "streaming") bumpGradient();
  }, [status, bumpGradient]);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      pageScrollY.value = event.contentOffset.y;
    },
  });

  // Floating "jump to latest" button. The list is inverted, so contentOffset.y
  // IS the distance scrolled up from the newest message. The reaction runs on
  // the UI thread and only crosses to JS when the threshold band is crossed —
  // not per scroll frame. Hysteresis (show past 200, hide under 120) keeps it
  // from flickering while hovering near the boundary.
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const jumpShown = useSharedValue(false);
  useAnimatedReaction(
    () => pageScrollY.value,
    (y) => {
      if (!jumpShown.value && y > 200) {
        jumpShown.value = true;
        runOnJS(setShowJumpToLatest)(true);
      } else if (jumpShown.value && y < 120) {
        jumpShown.value = false;
        runOnJS(setShowJumpToLatest)(false);
      }
    },
  );
  const handleJumpToLatest = useCallback(() => {
    // Inverted list: offset 0 is the visual bottom (newest message).
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);
  const bubbleGradient = useMemo<BubbleGradientValue>(
    () => ({ scrollY: pageScrollY, measureTick }),
    [pageScrollY, measureTick],
  );

  const handleNewConversation = () => {
    const reset = () => {
      startNewConversation();
      setStagedImages([]);
      setStagedGif(null);
      // Clear any conversationId route param so the load effect doesn't
      // immediately re-hydrate the conversation we just cleared.
      if (params.conversationId) {
        router.setParams({ conversationId: "" });
      }
    };

    if (newConvoTimer.current) clearTimeout(newConvoTimer.current);
    contentOpacity.value = withTiming(0, { duration: 160 });
    // Swap content at the trough of the fade, then fade the empty state in.
    newConvoTimer.current = setTimeout(() => {
      newConvoTimer.current = null;
      reset();
      contentOpacity.value = withTiming(1, { duration: 240 });
    }, 170);
  };

  // If the app resumes from background while contentOpacity is stuck at 0
  // (e.g. the device locked mid-fade-out), force it back to visible.
  // Also reset picker state so the invisible tap-intercept overlay never
  // persists after a background/foreground cycle.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (contentOpacity.value < 0.5 && !newConvoTimer.current) {
          contentOpacity.value = withTiming(1, { duration: 240 });
        }
        setMemesOpen(false);
        setGifsOpen(false);
      }
    });
    return () => sub.remove();
  }, [contentOpacity]);

  // The color the floating dock's scrim (and the accessory row's edge fade)
  // dissolves messages into. For solid backdrops it's the backdrop itself;
  // for a custom gradient we take the LAST stop — the dock sits at the
  // bottom of the screen, where a top→bottom gradient lands on that color.
  const scrimColor =
    chatBackground.kind === "solid"
      ? (chatBackground.color ?? theme["--color-background"])
      : (chatBackground.gradientColors?.[
          chatBackground.gradientColors.length - 1
        ] ?? theme["--color-background"]);
  // Same idea for the thread's top edge, which sits on the FIRST gradient
  // stop (or the solid backdrop) — feeds the header-side fade.
  const headerFadeColor =
    chatBackground.kind === "solid"
      ? (chatBackground.color ?? theme["--color-background"])
      : (chatBackground.gradientColors?.[0] ?? theme["--color-background"]);

  return (
    <ChatToneContext.Provider value={chatThemeContext}>
      <AttachmentViewerProvider>
        {/* Not the stock KeyboardAvoidingView: that one can hold a stale
            keyboard pad after a background/foreground cycle (iOS drops the
            hide event), squishing the whole screen to the top until the next
            keyboard cycle. See AppKeyboardAvoidingView. */}
        <AppKeyboardAvoidingView
          style={{
            flex: 1,
            backgroundColor:
              chatBackground.kind === "solid"
                ? (chatBackground.color ?? theme["--color-background"])
                : theme["--color-background"],
          }}
        >
          {chatBackground.kind === "gradient" &&
          chatBackground.gradientColors ? (
            // Custom gradient background sits behind the whole thread. Rendered as
            // an absolute-fill sibling before the in-flow content so the header,
            // message list, and composer all paint on top of it.
            <LinearGradient
              colors={chatBackground.gradientColors}
              start={chatBackground.gradientStart ?? { x: 0, y: 0 }}
              end={chatBackground.gradientEnd ?? { x: 0, y: 1 }}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
          ) : null}

          <AppHeader
            title={t("chat.title")}
            right={
              // Always mounted so the button can fade in/out (it self-gates
              // taps via `visible`). Avoids the hard pop of conditional
              // mounting — and avoids Reanimated `entering` layout animations,
              // which leave the native hit-test frame unsynced on Fabric/release
              // and drop the first tap(s).
              <NewConversationButton
                label={t("chat.newConversation")}
                onPress={handleNewConversation}
                visible={canStartNew}
              />
            }
          />

          {/* Free-tier ad banner — sits under the header so it stays put while the
          composer + keyboard move. Hidden for Pro (any paid plan). */}
          <AdBanner style={{ marginHorizontal: 16, marginTop: 8 }} />

          <BubbleGradientContext.Provider value={bubbleGradient}>
            <ThinkingLabelContext.Provider value={thinkingLabel}>
            <View style={{ flex: 1 }}>
              <Animated.FlatList
                ref={listRef}
                style={[contentFadeStyle, { flex: 1 }]}
                inverted
                data={visibleMessages}
                keyExtractor={messageKey}
                keyboardShouldPersistTaps="handled"
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                onContentSizeChange={handleContentSizeChange}
                onMomentumScrollEnd={bumpGradient}
                // Inverted list: "end" is the visual top — reaching it loads
                // the next page of older messages (no-ops when exhausted).
                onEndReached={loadOlderMessages}
                onEndReachedThreshold={0.5}
                // Virtualization tuning for long threads with variable-height
                // rows (FlatList kept over FlashList — see perf plan, Phase 6
                // fallback). removeClippedSubviews intentionally NOT set: it
                // can break the gradient bubbles' measureInWindow anchoring.
                windowSize={7}
                maxToRenderPerBatch={8}
                initialNumToRender={12}
                updateCellsBatchingPeriod={50}
                ListFooterComponent={
                  // Visual top of the inverted list: paging spinner.
                  loadingOlder ? (
                    <View style={{ paddingVertical: 12 }}>
                      <ActivityIndicator
                        size="small"
                        color={theme["--color-foreground-muted"]}
                      />
                    </View>
                  ) : null
                }
                contentContainerStyle={{
                  flexGrow: 1,
                  justifyContent:
                    visibleMessages.length === 0 ? "center" : "flex-start",
                  paddingHorizontal: 18,
                  // Inverted list: paddingTop is the VISUAL BOTTOM. The
                  // floating dock overlays the list, so resting content needs
                  // its measured height (plus breathing room reaching into
                  // the fade ramp) to sit clear of it; scrolled content runs
                  // behind the dock and dissolves in the scrim. Falls back to
                  // 16 for the first frame, before the dock reports a height.
                  paddingTop: dockHeight > 0 ? dockHeight + 8 : 16,
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
                      // Lives inside the scrollable empty state (it only shows
                      // on a fresh chat) so the content never shears against a
                      // pinned banner when the keyboard shrinks the viewport.
                      header={
                        showMemoryBanner ? (
                          <MemoryOnBanner
                            label={t("chat.memory.bannerOn")}
                            a11yLabel={t("chat.memory.bannerA11y")}
                            color={theme["--color-foreground-muted"]}
                            onPress={openMemorySheet}
                          />
                        ) : null
                      }
                    />
                  )
                }
                renderItem={({ item }) => (
                  <MessageBubble
                    message={item}
                    retryLabel={t("common.retry")}
                    errorLabel={t("chat.errors.generic")}
                    onRetry={handleRetry}
                    onRate={rateMessage}
                    onEmoji={setMessageEmoji}
                    isLastAgent={
                      item.serverId != null &&
                      item.serverId === lastAgentServerId
                    }
                    onReplay={replayTurn}
                  />
                )}
              />
              {/* While a picker is open, a transparent layer over the thread turns a
            tap on the conversation into "dismiss the picker" — the same
            tap-away gesture that closes a keyboard. Only mounted when open, so
            it never intercepts normal scrolling or message taps otherwise. */}
              {anyPickerOpen({ memesOpen, gifsOpen }) ? (
                <Pressable
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  onPress={() => applyPickers(dismissPickers())}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {/* Header-side counterpart to the dock's fade ramp: a short
                  backdrop-colored gradient pinned to the thread's top edge,
                  dissolving messages just before they reach the header. */}
              <LinearGradient
                pointerEvents="none"
                colors={[headerFadeColor, withAlpha(headerFadeColor, 0)]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: HEADER_FADE_HEIGHT,
                }}
              />
            </View>
            </ThinkingLabelContext.Provider>
          </BubbleGradientContext.Provider>

          {/* Floating composer dock. Absolutely positioned so the thread
              scrolls edge-to-edge behind it; the list's bottom inset
              (dockHeight, measured here) keeps resting messages above it.
              The "glass" is transparency, not native blur: a near-opaque
              scrim of the backdrop color over the dock body, with a gradient
              ramp above it that dissolves passing messages — the ChatGPT-
              style fade — instead of a hard cut. */}
          <View
            onLayout={(e) => setDockHeight(e.nativeEvent.layout.height)}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
          >
            <LinearGradient
              pointerEvents="none"
              colors={[withAlpha(scrimColor, 0), withAlpha(scrimColor, 0.94)]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={{
                position: "absolute",
                top: -DOCK_FADE_HEIGHT,
                left: 0,
                right: 0,
                height: DOCK_FADE_HEIGHT,
              }}
            />
            <View
              pointerEvents="none"
              style={{
                ...StyleSheet.absoluteFillObject,
                backgroundColor: withAlpha(scrimColor, 0.94),
              }}
            />
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
              // Shimmer placeholder in the composer's exact resting geometry
              // (not a second brainrot avatar — the thread above already has
              // one): when the real composer mounts it lands on these shapes.
              <Animated.View entering={FadeIn.duration(220)}>
                <ComposerSkeleton />
              </Animated.View>
            ) : atLimit && usage ? (
              // 100% of the binding allowance is spent: the composer is replaced
              // by an upgrade prompt so the user can't keep typing into a wall.
              // Plain View (no `entering`) so the upgrade button's hit-test
              // frame stays synced on Fabric — same fix as the composer below.
              <View>
                <UsageLimitBlock
                  usage={usage}
                  isTopTier={isTopTier}
                  onUpgrade={openPlan}
                />
              </View>
            ) : (
              // NOTE: plain View, not an `entering` Animated.View. The entering
              // fade desynced the photo button's hit-test frame on Fabric (the
              // "tap the camera repeatedly before it opens" bug). The composer
              // just appears instead of fading in — a fair trade for taps that
              // always register.
              <View>
                {nearLimit && usage ? (
                  <UsageNudge
                    usage={usage}
                    isTopTier={isTopTier}
                    onUpgrade={openPlan}
                  />
                ) : null}
                <CollapsiblePicker open={memesOpen}>
                  <View style={{ paddingBottom: 8 }}>
                    <TrendingMemeStrip
                      items={klipy.memes}
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
                      onSelectItem={handleSelectMeme}
                      labels={{
                        searchPlaceholder: t("chat.memes.searchPlaceholder"),
                        empty: t("chat.memes.empty"),
                        noResults: t("chat.memes.noResults"),
                        error: t("chat.memes.error"),
                        retry: t("chat.memes.retry"),
                      }}
                    />
                  </View>
                </CollapsiblePicker>
                <CollapsiblePicker open={gifsOpen}>
                  <View style={{ paddingBottom: 8 }}>
                    <TrendingMemeStrip
                      items={klipyGifs.gifs}
                      loading={klipyGifs.loading}
                      loadingMore={klipyGifs.loadingMore}
                      error={klipyGifs.error}
                      hasNext={klipyGifs.hasNext}
                      mode={klipyGifs.mode}
                      searching={klipyGifs.searching}
                      query={klipyGifs.query}
                      onChangeQuery={klipyGifs.setQuery}
                      onClearSearch={klipyGifs.clearSearch}
                      onEndReached={klipyGifs.loadMore}
                      onRetry={klipyGifs.retry}
                      onSelectItem={handleSelectGif}
                      animated
                      labels={{
                        searchPlaceholder: t("chat.gifs.searchPlaceholder"),
                        empty: t("chat.gifs.empty"),
                        noResults: t("chat.gifs.noResults"),
                        error: t("chat.gifs.error"),
                        retry: t("chat.gifs.retry"),
                      }}
                    />
                  </View>
                </CollapsiblePicker>
                <CollapsiblePicker
                  open={
                    stagedImages.length > 0 || stagedGif !== null || maxNotice
                  }
                >
                  <StagedAttachmentTray
                    images={stagedImages}
                    gif={stagedGif}
                    showMaxNotice={maxNotice}
                    onRemove={handleRemoveStagedImage}
                    onRemoveGif={handleRemoveStagedGif}
                  />
                </CollapsiblePicker>
                <ChatInput
                  ref={chatInputRef}
                  value={draft}
                  onChangeText={setDraft}
                  onSend={handleSubmit}
                  onCancel={cancelStreaming}
                  onFocus={() => applyPickers(dismissPickers())}
                  streaming={status === "streaming"}
                  hasAttachments={stagedImages.length > 0 || stagedGif !== null}
                  placeholder={t("chat.input.placeholder")}
                  sendAccessibilityLabel={t("chat.send")}
                  cancelAccessibilityLabel={t("chat.cancel")}
                  expandAccessibilityLabel={t("chat.expand")}
                  collapseAccessibilityLabel={t("chat.collapse")}
                />
                {/* Composer accessory row. The chips grow to fill the width
                evenly when they fit, and the row scrolls horizontally rather
                than cropping a label when they don't (narrow screens / long
                locales) — with a trailing fade hinting at the hidden chips.
                The row sits on the dock's scrim, so the scrim color is the
                backdrop the fade dissolves into — including over custom
                gradient backgrounds. */}
                <EdgeFadedScrollRow
                  fadeColor={scrimColor}
                  style={{ marginTop: 8, marginHorizontal: -16 }}
                  contentContainerStyle={{
                    flexGrow: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 16,
                  }}
                >
                  <PhotoButton
                    label={t("chat.photo.button", {
                      defaultValue: "Add a photo",
                    })}
                    busy={uploadingImage}
                    onPress={handleAddPhoto}
                  />
                  <GifToggleButton
                    label={
                      gifsOpen ? t("chat.gifs.keyboard") : t("chat.gifs.button")
                    }
                    open={gifsOpen}
                    onPress={handleToggleGifs}
                  />
                  <MemeToggleButton
                    label={
                      memesOpen
                        ? t("chat.memes.keyboard")
                        : t("chat.memes.button")
                    }
                    open={memesOpen}
                    onPress={handleToggleMemes}
                  />
                  <RotLevelButton
                    label={t("chat.rot.button")}
                    level={rotLevel}
                    onPress={handleOpenRot}
                  />
                </EdgeFadedScrollRow>
              </View>
            )}
            </View>
          </View>

          {/* Floating jump-to-latest. Sits just above the dock (which the
              measured dockHeight tracks through picker opens and keyboard
              moves) and right-aligned with the dock's 16px padding. */}
          <View
            style={{
              position: "absolute",
              right: 16,
              bottom: dockHeight + 12,
            }}
          >
            <ScrollToBottomButton
              label={t("chat.scrollToBottom")}
              visible={showJumpToLatest}
              onPress={handleJumpToLatest}
            />
          </View>

          <QuotaModal
            quota={quota}
            isTopTier={isTopTier}
            onUpgrade={openPlan}
            onDismiss={dismissQuota}
          />
        </AppKeyboardAvoidingView>
      </AttachmentViewerProvider>
    </ChatToneContext.Provider>
  );
}
