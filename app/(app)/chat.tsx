import { AdBanner } from "@/components/ads/AdBanner";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { AppHeader, useAppHeaderHeight } from "@/components/AppHeader";
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
import {
  TimeRevealContext,
  TIME_REVEAL_WIDTH,
  type TimeRevealValue,
} from "@/components/chat/TimeRevealContext";
import { ChatLoading } from "@/components/chat/ChatLoading";
import { CollapsiblePicker } from "@/components/chat/CollapsiblePicker";
import {
  BigBrainToggleButton,
  MediaToggleButton,
  PhotoButton,
  RotLevelButton,
} from "@/components/chat/ComposerToggles";
import { MediaTabBar } from "@/components/chat/MediaTabBar";
import { EdgeFadedScrollRow } from "@/components/chat/EdgeFadedScrollRow";
import { EmptyChatState } from "@/components/chat/EmptyChatState";
import { BigBrainBanner } from "@/components/chat/BigBrainBanner";
import { MemoryOnBanner } from "@/components/chat/MemoryOnBanner";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { NewConversationButton } from "@/components/chat/NewConversationButton";
import {
  anyPickerOpen,
  dismissPickers,
  PICKERS_CLOSED,
  selectMediaTab,
  toggleMedia,
  type MediaTab,
  type PickerVisibility,
} from "@/components/chat/pickerVisibility";
import { QuotaModal } from "@/components/chat/QuotaModal";
import { StagedAttachmentTray } from "@/components/chat/StagedAttachmentTray";
import { messageKey, type RenderMessage } from "@/components/chat/types";
import {
  UsageLimitBlock,
  UsageNudge,
} from "@/components/chat/UsageNotices";
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
import {
  MAX_MESSAGE_STICKERS,
  trendingStickerToMessageSticker,
  type MessageSticker,
  type TrendingSticker,
} from "@/domain/stickers";
import { computeUsageState, type UsageState } from "@/domain/usage";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { useKlipy } from "@/hooks/useKlipy";
import { useKlipyGifs } from "@/hooks/useKlipyGifs";
import { useKlipyStickers } from "@/hooks/useKlipyStickers";
import { useOnSendEffects } from "@/hooks/useOnSendEffects";
import { useMemoryMeta } from "@/hooks/useMemory";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { ChatToneContext } from "@/hooks/useTheme";
import { PLAN_RANK } from "@/domain/billing";
import { withAlpha } from "@/domain/customization";
import { useChatStore } from "@/store/chat";
import { useDisplayPlan, useEntitlementStore } from "@/store/entitlement";
import { useMemorySheetStore } from "@/store/memorySheet";
import { usePersonaSheetStore } from "@/store/personaSheet";
import {
  useSelectedPersona,
  usePersonaSelectionReady,
  usePersonaStore,
} from "@/store/personas";
import { DEFAULT_PERSONA_ID, resolvePersonaSlot } from "@/domain/personas";
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
  Easing,
  FadeIn,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Height of the gradient ramp above the floating composer dock — the zone
// where scrolling messages dissolve into the backdrop instead of hard-cutting.
const DOCK_FADE_HEIGHT = 21;
// Ramp height while a reply streams. Kept equal to the list's bottom breathing
// room (paddingTop = dockHeight + 10 below), so the resting streaming bubble's
// last line sits exactly on the fade's leading edge — no gap, no wash. The
// in-flight bubble carries no stand-in (see MessageBubble).
const DOCK_FADE_HEIGHT_STREAMING = 10;

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
  // Floating header is absolute, so the list scrolls under it; this is the top
  // inset resting content needs. "avatar" variant — chat shows the persona
  // avatar above the title pill.
  const headerHeight = useAppHeaderHeight("avatar");
  // Measured height of the pinned ad band just below the header (0 for Pro,
  // where AdBanner renders nothing). Feeds the list's visual-top inset.
  const [adTopInset, setAdTopInset] = useState(0);
  // The unified media drawer's visibility + active tab (GIFs · Memes ·
  // Stickers). One drawer replaced the separate meme/GIF surfaces so a third
  // sticker chip wouldn't overflow the composer row (see pickerVisibility).
  const [pickers, setPickers] = useState<PickerVisibility>(PICKERS_CLOSED);
  const mediaOpen = pickers.mediaOpen;
  const mediaTab = pickers.mediaTab;
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
  // Stickers the user has staged but not yet sent (up to MAX_MESSAGE_STICKERS).
  // Independent of the meme + GIF caps — a turn may combine all three.
  const [stagedStickers, setStagedStickers] = useState<MessageSticker[]>([]);
  // True while a captured/picked photo is being compressed + uploaded to
  // Storage, so the photo button can show a spinner and block re-taps.
  const [uploadingImage, setUploadingImage] = useState(false);
  // Brief "you can only attach N" notice, shown when a cap is exceeded. The
  // count tracks which cap was hit (memes share MAX_MESSAGE_IMAGES; stickers use
  // MAX_MESSAGE_STICKERS) so the notice reads the right number.
  const [maxNotice, setMaxNotice] = useState(false);
  const [maxNoticeCount, setMaxNoticeCount] = useState(MAX_MESSAGE_IMAGES);
  const maxNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Memes for the composer strip (trending + debounced KLIPY search). Modular —
  // the same hook can power a meme picker anywhere else in the app. `enabled`
  // defers the first network call until the strip is actually opened.
  const klipy = useKlipy({
    perPage: 24,
    enabled: mediaOpen && mediaTab === "memes",
  });
  // GIFs + stickers for the composer strip — same engine, different Klipy
  // endpoints. Each is deferred until the drawer is open on its tab, so only the
  // active tab fetches.
  const klipyGifs = useKlipyGifs({
    perPage: 24,
    enabled: mediaOpen && mediaTab === "gifs",
  });
  const klipyStickers = useKlipyStickers({
    perPage: 24,
    enabled: mediaOpen && mediaTab === "stickers",
  });
  const conversationId = useChatStore((s) => s.conversationId);
  // Brainrot intensity dial. Sticky and persisted in the chat store, applied to
  // every turn; defaults to "Rotted". Edited via the RotLevelSheet (mounted in
  // the root layout, opened here through useRotLevelSheetStore).
  const rotLevel = useChatStore((s) => s.rotLevel);
  // Sticky Big Brain reply-model upgrade. Persisted in the chat store, applied
  // to every turn; defaults off. Toggled in place from the composer chip.
  const bigBrain = useChatStore((s) => s.bigBrain);
  const setBigBrain = useChatStore((s) => s.setBigBrain);
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
  const pauseStreaming = useChatStore((s) => s.pauseStreaming);
  const dismissQuota = useChatStore((s) => s.dismissQuota);
  const entitlement = useEntitlementStore((s) => s.entitlement);
  const currentPlan = useDisplayPlan();
  const openPlan = useOpenPlan();
  const openMemorySheet = useMemorySheetStore((s) => s.open);
  const openPersonaSheet = usePersonaSheetStore((s) => s.open);
  const selectedPersona = useSelectedPersona();
  // While the persisted persona pick is still resolving (restore + list load),
  // the header shows a loading pill instead of the default, so a returning user
  // never flashes Brainrot Bot before their saved bot lands.
  const personaReady = usePersonaSelectionReady();
  const { meta: memoryMeta } = useMemoryMeta();
  const router = useRouter();

  // The header pill reflects the locally-selected persona. Selection is
  // cosmetic for now — the chat send path does not yet forward personaId.
  const personaTitle =
    selectedPersona.kind === "default"
      ? t("chat.agentName")
      : selectedPersona.persona.displayName;

  // Bumped each time the app returns to the foreground (see the AppState
  // effect below). The entitlement in the store may predate a daily/monthly
  // reset boundary crossed while backgrounded — its object identity doesn't
  // change, so without this the usage memo would keep serving a stale
  // "at limit" and flash the upgrade block over a refilled allowance.
  const [appActiveAt, setAppActiveAt] = useState(() => Date.now());

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
      now: appActiveAt,
    });
  }, [entitlement, appActiveAt]);

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

  const currentPersonaId =
    selectedPersona.kind === "default" ? DEFAULT_PERSONA_ID : selectedPersona.persona.id;

  // One bot per conversation (we don't support group chat): the persona shown is
  // the conversation's own bot, and switching bots forks a new conversation. The
  // backend still records `participantPersonaIds` + per-message `personaId`
  // (kept for data continuity / legacy threads), but the chat UI no longer
  // surfaces more than one bot per session.
  //
  // The conversation's bot is the most recent agent reply's persona (a reply
  // with no stored personaId is a default-bot / legacy reply → the default).
  // null until the conversation has any agent reply (a brand-new chat simply
  // adopts whatever persona is selected).
  const conversationBotId = useMemo<string | null>(() => {
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].role === "agent") {
        return allMessages[i].personaId ?? DEFAULT_PERSONA_ID;
      }
    }
    return null;
  }, [allMessages]);

  // Raw persisted selection (NOT the resolved default-fallback) — stable across
  // persona-list hydration, so the fork effect below only fires on a real user
  // switch, never when a previously-unresolvable bot becomes resolvable.
  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const selectPersona = usePersonaStore((s) => s.select);

  // Resolve a message's sender bot once, in the parent, rather than each bubble
  // subscribing to the persona store. Stable across renders unless the saved
  // personas change, so MessageBubble's memo() still holds.
  const personas = usePersonaStore((s) => s.personas);
  const resolveSender = useCallback(
    (personaId: string | undefined) => resolvePersonaSlot(personaId, personas),
    [personas],
  );

  const visibleMessages = useMemo<RenderMessage[]>(
    () =>
      buildVisibleMessages({
        messages: allMessages,
        status,
        activeReplyClientId,
        settledReply,
        error,
        lastUserMessage,
        currentPersonaId,
      }),
    [
      activeReplyClientId,
      error,
      lastUserMessage,
      allMessages,
      settledReply,
      status,
      currentPersonaId,
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
    const stickers = stagedStickers;
    // Allow text-only, attachment-only, or text + attachments.
    if (
      text.length === 0 &&
      images.length === 0 &&
      !gif &&
      stickers.length === 0
    )
      return;
    // Clear the composer optimistically (mirrors text-draft behavior). The
    // attachments ride along on the optimistic user bubble, and the error
    // card's retry resends them, so a failed send never loses them.
    setDraft("");
    setStagedImages([]);
    setStagedGif(null);
    setStagedStickers([]);
    // Collapse the pickers on send so they don't linger empty above a
    // freshly-cleared composer. The keyboard is intentionally left up (we
    // don't blur) so rapid follow-up messages stay frictionless.
    applyPickers(dismissPickers(pickers));
    void sendMessage(text, images, gif, stickers, rotLevel);
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
      lastUser.stickers,
      lastUser.levelOfRot ?? state.rotLevel,
    );
  }, []);

  // Apply a computed picker-visibility transition to the drawer state. The pure
  // transitions in pickerVisibility.ts own the open/tab logic; this just commits
  // their result.
  const applyPickers = (next: PickerVisibility) => {
    setPickers(next);
  };

  // Toggle the whole media drawer. Each tab's hook `enabled` flag (wired to
  // mediaOpen + mediaTab) triggers its first fetch. The drawer and the system
  // keyboard occupy the same slot, so they're mutually exclusive: opening
  // dismisses the keyboard; closing hands focus back to the composer (which
  // raises the keyboard) — a clean keyboard ⇄ drawer swap.
  const handleToggleMedia = () => {
    const wasOpen = mediaOpen;
    applyPickers(toggleMedia(pickers));
    if (wasOpen) chatInputRef.current?.focus();
    else Keyboard.dismiss();
  };

  // Switch tabs inside the (already-open) drawer. No keyboard change — the
  // drawer stays put; only its content swaps.
  const handleSelectTab = (tab: MediaTab) => {
    applyPickers(selectMediaTab(pickers, tab));
  };

  // Opening the Rot Level sheet: dismiss the keyboard first so the 46% sheet
  // doesn't animate up behind it (otherwise it lands occluded), and close the
  // drawer so only one bottom surface is ever showing.
  const handleOpenRot = () => {
    Keyboard.dismiss();
    applyPickers(dismissPickers(pickers));
    openRotSheet();
  };

  const flashMaxNotice = useCallback((count: number) => {
    setMaxNoticeCount(count);
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
        flashMaxNotice(MAX_MESSAGE_IMAGES);
        return current;
      }
      return [...current, trendingMemeToMessageImage(meme)];
    });
  };

  const handleRemoveStagedImage = (id: string) => {
    setStagedImages((current) => current.filter((image) => image.id !== id));
  };

  // Tapping a GIF stages it (max one — a new pick replaces the current one).
  // Independent of the meme cap. Closes the drawer so the staged thumbnail is
  // immediately visible above the composer (a GIF is a single pick, unlike
  // memes/stickers which stay open to stack more).
  const handleSelectGif = (gif: TrendingGif) => {
    setStagedGif(trendingGifToMessageGif(gif));
    applyPickers(dismissPickers(pickers));
  };

  const handleRemoveStagedGif = () => {
    setStagedGif(null);
  };

  // Tapping a sticker stages it (up to MAX_MESSAGE_STICKERS). Deduped by id;
  // keeps the drawer open so the user can stack more. Stamps the active search
  // term (when picked from a search) so the backend can tell the model what the
  // user was looking for.
  const handleSelectSticker = (sticker: TrendingSticker) => {
    const searchQuery =
      klipyStickers.mode === "search" ? klipyStickers.query.trim() : undefined;
    setStagedStickers((current) => {
      if (current.some((s) => s.id === sticker.id)) return current;
      if (current.length >= MAX_MESSAGE_STICKERS) {
        flashMaxNotice(MAX_MESSAGE_STICKERS);
        return current;
      }
      return [
        ...current,
        trendingStickerToMessageSticker(sticker, searchQuery),
      ];
    });
  };

  const handleRemoveStagedSticker = (id: string) => {
    setStagedStickers((current) => current.filter((s) => s.id !== id));
  };

  // Capture or pick a photo, compress + upload it, and stage it as an upload
  // attachment. Deduped by the meme cap (uploads share MAX_MESSAGE_IMAGES with
  // Klipy memes); the backend re-enforces the cap.
  const stageUploadedPhoto = useCallback(
    async (source: PickSource) => {
      if (stagedImages.length >= MAX_MESSAGE_IMAGES) {
        flashMaxNotice(MAX_MESSAGE_IMAGES);
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
    // Functional update — this callback doesn't close over `pickers`, and a
    // dismiss only needs to flip the drawer shut (the active tab is preserved).
    setPickers((p) => dismissPickers(p));
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

  // The dock's dissolve ramp shrinks while a reply is thinking/streaming —
  // the in-flight bubble rests lower than a finalized one (no action row yet,
  // just the 10px stand-in), so the full ramp would wash out its last line
  // for the whole stream. It stays 10px tall rather than vanishing so a
  // message pulled down behind the dock mid-stream still dissolves instead
  // of hard-cutting, then eases back to full height alongside the action
  // row's entrance.
  const dockFadeHeight = useSharedValue(DOCK_FADE_HEIGHT);
  useEffect(() => {
    dockFadeHeight.value = withTiming(
      status === "streaming" ? DOCK_FADE_HEIGHT_STREAMING : DOCK_FADE_HEIGHT,
      { duration: status === "streaming" ? 150 : 220 },
    );
  }, [status, dockFadeHeight]);
  // Anchored to the dock's top edge: top tracks -height so the ramp shrinks
  // upward from the dock rather than detaching from it.
  const dockFadeStyle = useAnimatedStyle(() => ({
    height: dockFadeHeight.value,
    top: -dockFadeHeight.value,
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

  // iMessage-style swipe-to-reveal timestamps. A horizontal drag-left slides
  // every bubble left in unison (see MessageBubble's row transform) to expose
  // each message's time at the right margin; releasing springs it back. The pan
  // only claims horizontal movement (activeOffsetX) and yields to the list's
  // vertical scroll (failOffsetY), and — being a drag, not a press — it never
  // competes with the long-press that drives native text selection inside a
  // bubble. progress runs 0 (rest) → 1 (full reveal).
  const timeReveal = useSharedValue(0);
  const timeRevealGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          "worklet";
          // Only a leftward drag reveals; clamp to [0, 1].
          const raw = -e.translationX / TIME_REVEAL_WIDTH;
          timeReveal.value = Math.min(1, Math.max(0, raw));
        })
        .onFinalize(() => {
          "worklet";
          timeReveal.value = withTiming(0, {
            duration: 240,
            easing: Easing.out(Easing.cubic),
          });
        }),
    [timeReveal],
  );
  const timeRevealValue = useMemo<TimeRevealValue>(
    () => ({ progress: timeReveal }),
    [timeReveal],
  );

  const handleNewConversation = useCallback(() => {
    const reset = () => {
      startNewConversation();
      setStagedImages([]);
      setStagedGif(null);
      setStagedStickers([]);
      // Clear any conversationId route param so the load effect doesn't
      // immediately re-hydrate the conversation we just cleared.
      if (params.conversationId) {
        router.setParams({ conversationId: "" });
      }
    };

    if (newConvoTimer.current) clearTimeout(newConvoTimer.current);
    // True 0 is fine here: the glass empty-state prompts receive this same
    // SharedValue as fadeProgress, so they flip glassEffectStyle to 'none' near
    // 0 (the Expo-sanctioned fade) instead of being blanked by the opacity-0
    // ancestor. See GlassSurface's opacity-0 note + fadeProgress.
    contentOpacity.value = withTiming(0, { duration: 160 });
    // Swap content at the trough of the fade, then fade the empty state in.
    newConvoTimer.current = setTimeout(() => {
      newConvoTimer.current = null;
      reset();
      contentOpacity.value = withTiming(1, { duration: 240 });
    }, 170);
  }, [startNewConversation, params.conversationId, router, contentOpacity]);

  // One bot per conversation, part 1 — adopt the conversation's bot on open.
  // When an existing conversation (with at least one reply) is loaded, sync the
  // active persona to that conversation's bot exactly once, so opening a session
  // from history / a deep link / the resumed last session shows that session's
  // bot. A brand-new conversation has no bot yet (conversationBotId === null) and
  // simply keeps whatever's selected. Guarded per-conversation so it never fights
  // a later user switch.
  const syncedConvoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId) {
      syncedConvoRef.current = null;
      return;
    }
    if (conversationBotId == null) return;
    if (syncedConvoRef.current === conversationId) return;
    syncedConvoRef.current = conversationId;
    if (conversationBotId !== selectedPersonaId) {
      selectPersona(conversationBotId);
    }
  }, [conversationId, conversationBotId, selectedPersonaId, selectPersona]);

  // One bot per conversation, part 2 — switching bots forks a new chat. When the
  // user changes the active persona while in a conversation whose established bot
  // differs, start a fresh conversation (with the newly-picked bot) rather than
  // letting a second bot into the thread. The prev-ref guard means this fires
  // only on an actual selection change; the `=== conversationBotId` guard means
  // the part-1 sync above (which also calls selectPersona) never triggers a fork.
  const prevSelectedRef = useRef(selectedPersonaId);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedPersonaId;
    if (prev === selectedPersonaId) return;
    if (!conversationId) return; // nothing to fork from on a blank new chat
    if (conversationBotId == null) return; // no established bot → it adopts the pick
    if (selectedPersonaId === conversationBotId) return; // load-sync, not a switch
    handleNewConversation();
  }, [selectedPersonaId, conversationId, conversationBotId, handleNewConversation]);

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
        setPickers((p) => dismissPickers(p));
        // Re-evaluate usage against the current clock — a reset boundary may
        // have passed while backgrounded (see the usage memo above).
        setAppActiveAt(Date.now());
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

          <BubbleGradientContext.Provider value={bubbleGradient}>
            <TimeRevealContext.Provider value={timeRevealValue}>
            <ThinkingLabelContext.Provider value={thinkingLabel}>
            <View style={{ flex: 1 }}>
              <GestureDetector gesture={timeRevealGesture}>
              <Animated.FlatList
                ref={listRef}
                style={[contentFadeStyle, { flex: 1 }]}
                inverted
                data={visibleMessages}
                keyExtractor={messageKey}
                keyboardShouldPersistTaps="handled"
                // Instagram-style swipe-to-dismiss: starting a drag on the
                // thread dismisses the keyboard. "on-drag" (not "interactive")
                // is deliberate — the composer dock tracks the keyboard via the
                // JS keyboardWillHide event (AppKeyboardAvoidingView), which
                // only fires on dismiss, not during an interactive finger-drag.
                // So on-drag keeps the keyboard + composer descending together;
                // interactive would leave the dock floating with a gap until
                // release. (Faithful finger-tracking needs a native keyboard
                // module, and those crash this Expo Go — see chat memory.)
                keyboardDismissMode="on-drag"
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
                  // its measured height (plus breathing room — enough that
                  // the last reply's action row mostly clears the fade ramp
                  // without floating the thread too high) to sit clear of it;
                  // scrolled content runs behind the dock and dissolves in
                  // the scrim. Falls back to 16 for the first frame, before
                  // the dock reports a height.
                  paddingTop: dockHeight > 0 ? dockHeight + 10 : 16,
                  // Inverted list: paddingBottom is the VISUAL TOP. The
                  // floating header + pinned ad band overlay the thread here,
                  // so resting (oldest visible) content needs their combined
                  // height to clear them; scrolled content runs under and
                  // dissolves in the header's darken fade.
                  paddingBottom: 18 + headerHeight + adTopInset,
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
                      // Same value that drives the list's contentFadeStyle, so
                      // the glass starter prompts switch to 'none' as the list
                      // fades to 0 during a new-chat swap (Expo glass-fade) —
                      // not blanked by the opacity-0 ancestor.
                      fadeProgress={contentOpacity}
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
                    showSenderAvatar={false}
                    resolveSender={resolveSender}
                    isLastAgent={
                      item.serverId != null &&
                      item.serverId === lastAgentServerId
                    }
                    onReplay={replayTurn}
                  />
                )}
              />
              </GestureDetector>
              {/* While a picker is open, a transparent layer over the thread turns a
            tap on the conversation into "dismiss the picker" — the same
            tap-away gesture that closes a keyboard. Only mounted when open, so
            it never intercepts normal scrolling or message taps otherwise. */}
              {anyPickerOpen(pickers) ? (
                <Pressable
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  onPress={() => applyPickers(dismissPickers(pickers))}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {/* The thread's top dissolve is handled by the floating header's
                  own darken fade (AppHeader, rendered below as an overlay). */}
            </View>
            </ThinkingLabelContext.Provider>
            </TimeRevealContext.Provider>
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
            <Animated.View
              pointerEvents="none"
              style={[
                { position: "absolute", left: 0, right: 0 },
                dockFadeStyle,
              ]}
            >
              <LinearGradient
                colors={[withAlpha(scrimColor, 0), withAlpha(scrimColor, 0.59)]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <View
              pointerEvents="none"
              style={{
                ...StyleSheet.absoluteFillObject,
                backgroundColor: withAlpha(scrimColor, 0.59),
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
                {/* Subtle glass status pill while Big Brain is on — sits right
                    above the composer (same slot as the usage nudge). Always
                    mounted and driven by `on` so it can fade + collapse in/out
                    smoothly (and keep the Liquid Glass material alive across the
                    fade — see BigBrainBanner). Tapping it turns Big Brain off. */}
                <BigBrainBanner
                  on={bigBrain}
                  label={t("chat.bigBrain.bannerOn")}
                  a11yLabel={t("chat.bigBrain.bannerA11y")}
                  onPress={() => setBigBrain(false)}
                />
                {/* Unified media drawer: one collapsible surface with a tab
                    header (GIFs · Memes · Stickers) above the active strip. Only
                    the active tab's hook fetches (see `enabled` wiring above). */}
                <CollapsiblePicker open={mediaOpen}>
                  <View style={{ paddingBottom: 8 }}>
                    <MediaTabBar
                      tab={mediaTab}
                      onChange={handleSelectTab}
                      labels={{
                        gifs: t("chat.media.tabs.gifs"),
                        memes: t("chat.media.tabs.memes"),
                        stickers: t("chat.media.tabs.stickers"),
                      }}
                    />
                    {mediaTab === "gifs" ? (
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
                        bleed={16}
                        labels={{
                          searchPlaceholder: t("chat.gifs.searchPlaceholder"),
                          empty: t("chat.gifs.empty"),
                          noResults: t("chat.gifs.noResults"),
                          error: t("chat.gifs.error"),
                          retry: t("chat.gifs.retry"),
                        }}
                      />
                    ) : null}
                    {mediaTab === "memes" ? (
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
                        bleed={16}
                        labels={{
                          searchPlaceholder: t("chat.memes.searchPlaceholder"),
                          empty: t("chat.memes.empty"),
                          noResults: t("chat.memes.noResults"),
                          error: t("chat.memes.error"),
                          retry: t("chat.memes.retry"),
                        }}
                      />
                    ) : null}
                    {mediaTab === "stickers" ? (
                      <TrendingMemeStrip
                        items={klipyStickers.stickers}
                        loading={klipyStickers.loading}
                        loadingMore={klipyStickers.loadingMore}
                        error={klipyStickers.error}
                        hasNext={klipyStickers.hasNext}
                        mode={klipyStickers.mode}
                        searching={klipyStickers.searching}
                        query={klipyStickers.query}
                        onChangeQuery={klipyStickers.setQuery}
                        onClearSearch={klipyStickers.clearSearch}
                        onEndReached={klipyStickers.loadMore}
                        onRetry={klipyStickers.retry}
                        onSelectItem={handleSelectSticker}
                        animated
                        // Transparent stickers read best uncropped + with no
                        // grey tile behind them.
                        contentFit="contain"
                        transparent
                        bleed={16}
                        labels={{
                          searchPlaceholder: t("chat.stickers.searchPlaceholder"),
                          empty: t("chat.stickers.empty"),
                          noResults: t("chat.stickers.noResults"),
                          error: t("chat.stickers.error"),
                          retry: t("chat.stickers.retry"),
                        }}
                      />
                    ) : null}
                  </View>
                </CollapsiblePicker>
                <CollapsiblePicker
                  open={
                    stagedImages.length > 0 ||
                    stagedGif !== null ||
                    stagedStickers.length > 0 ||
                    maxNotice
                  }
                >
                  <StagedAttachmentTray
                    images={stagedImages}
                    gif={stagedGif}
                    stickers={stagedStickers}
                    showMaxNotice={maxNotice}
                    maxNoticeCount={maxNoticeCount}
                    onRemove={handleRemoveStagedImage}
                    onRemoveGif={handleRemoveStagedGif}
                    onRemoveSticker={handleRemoveStagedSticker}
                  />
                </CollapsiblePicker>
                <ChatInput
                  ref={chatInputRef}
                  value={draft}
                  onChangeText={setDraft}
                  onSend={handleSubmit}
                  onCancel={pauseStreaming}
                  onFocus={() => applyPickers(dismissPickers(pickers))}
                  streaming={status === "streaming"}
                  hasAttachments={
                    stagedImages.length > 0 ||
                    stagedGif !== null ||
                    stagedStickers.length > 0
                  }
                  placeholder={t("chat.input.placeholder", { name: personaTitle })}
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
                  <MediaToggleButton
                    label={
                      mediaOpen
                        ? t("chat.media.keyboard")
                        : t("chat.media.button")
                    }
                    open={mediaOpen}
                    onPress={handleToggleMedia}
                  />
                  <RotLevelButton
                    label={t("chat.rot.button")}
                    level={rotLevel}
                    onPress={handleOpenRot}
                  />
                  <BigBrainToggleButton
                    label={t("chat.bigBrain.button")}
                    on={bigBrain}
                    onPress={() => setBigBrain(!bigBrain)}
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

          {/* Free-tier ad banner — pinned just below the floating header so it
              stays put while the composer + keyboard move. Measured height
              feeds the list's visual-top inset (0 for Pro, where AdBanner
              renders nothing). Hidden for Pro (any paid plan). */}
          <View
            pointerEvents="box-none"
            onLayout={(e) => setAdTopInset(e.nativeEvent.layout.height)}
            style={{
              position: "absolute",
              top: headerHeight,
              left: 0,
              right: 0,
            }}
          >
            <AdBanner style={{ marginHorizontal: 16 }} />
          </View>

          {/* Floating header overlay: persona avatar above a glass pill with
              the persona name. fadeColor is the background-aware top-edge
              color so a custom chat background doesn't show a wrong band. */}
          <AppHeader
            title={personaTitle}
            avatar={<PersonaAvatar persona={selectedPersona} size={26} />}
            onTitlePress={openPersonaSheet}
            loading={!personaReady}
            fadeColor={headerFadeColor}
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
