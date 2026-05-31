import { AdBanner } from "@/components/ads/AdBanner";
import { AppHeader } from "@/components/AppHeader";
import { AttachmentViewerProvider } from "@/components/AttachmentViewer";
import { ChatInput, type ChatInputRef } from "@/components/ChatInput";
import { buildVisibleMessages } from "@/components/chat/buildVisibleMessages";
import {
  BubbleGradientContext,
  type BubbleGradientValue,
} from "@/components/chat/BubbleGradientContext";
import { ChatLoading } from "@/components/chat/ChatLoading";
import { CollapsiblePicker } from "@/components/chat/CollapsiblePicker";
import {
  GifToggleButton,
  MemeToggleButton,
  PhotoButton,
  RotLevelButton,
} from "@/components/chat/ComposerToggles";
import { EmptyChatState } from "@/components/chat/EmptyChatState";
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
import { MemeAvatar } from "@/components/MemeAvatar";
import {
  RotLevelSheet,
  type RotLevelSheetRef,
} from "@/components/RotLevelSheet";
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
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { ChatToneContext } from "@/hooks/useTheme";
import { useChatStore } from "@/store/chat";
import { useDisplayPlan, useEntitlementStore } from "@/store/entitlement";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
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
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ChatScreen() {
  const { t } = useTranslation();
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
  const [memesOpen, setMemesOpen] = useState(false);
  const [gifsOpen, setGifsOpen] = useState(false);
  const rotSheetRef = useRef<RotLevelSheetRef>(null);
  const chatInputRef = useRef<ChatInputRef>(null);
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
  // every turn; defaults to "Rotted". Edited via the RotLevelSheet below.
  const rotLevel = useChatStore((s) => s.rotLevel);
  const setRotLevel = useChatStore((s) => s.setRotLevel);
  const hydrateSession = useChatStore((s) => s.hydrateSession);
  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const streamingMeme = useChatStore((s) => s.streamingMeme);
  const streamingGif = useChatStore((s) => s.streamingGif);
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

  const visibleMessages = useMemo<RenderMessage[]>(
    () =>
      buildVisibleMessages({
        messages,
        status,
        activeReplyClientId,
        streamingText,
        streamingMeme,
        streamingGif,
        settledReply,
        error,
        lastUserMessage,
      }),
    [
      activeReplyClientId,
      error,
      lastUserMessage,
      messages,
      settledReply,
      status,
      streamingText,
      streamingMeme,
      streamingGif,
    ],
  );

  const handleSubmit = () => {
    if (atLimit) return;
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
  };

  // Tapping a starter chip drops its text into the composer and focuses it,
  // rather than firing the message off. The user can tweak it (or just hit
  // send), so a starter is a head-start, not an irreversible send.
  const handleStarterPress = (text: string) => {
    if (atLimit) return;
    setDraft(text);
    chatInputRef.current?.focus();
  };

  const handleRetry = () => {
    if (!lastUserMessage) return;
    // Resend the failed turn's attachments too, so a meme/gif isn't dropped on
    // retry. Reuse the level the original turn carried, falling back to the
    // current dial if it predates the feature.
    void sendMessage(
      lastUserMessage.text,
      lastUserMessage.images,
      lastUserMessage.gifs?.[0] ?? null,
      lastUserMessage.levelOfRot ?? rotLevel,
    );
  };

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
    rotSheetRef.current?.present();
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
  // re-anchor whenever the layout settles.
  const pageScrollY = useSharedValue(0);
  const [gradientTick, setGradientTick] = useState(0);
  const bumpGradient = useCallback(() => setGradientTick((t) => t + 1), []);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      pageScrollY.value = event.contentOffset.y;
    },
  });
  const bubbleGradient = useMemo<BubbleGradientValue>(
    () => ({ scrollY: pageScrollY, measureTick: gradientTick }),
    [pageScrollY, gradientTick],
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

    contentOpacity.value = withTiming(0, { duration: 160 });
    // Swap content at the trough of the fade, then fade the empty state in.
    setTimeout(() => {
      reset();
      contentOpacity.value = withTiming(1, { duration: 240 });
    }, 170);
  };

  return (
    <ChatToneContext.Provider value={chatThemeContext}>
      <AttachmentViewerProvider>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
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
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
          ) : null}

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

          {/* Free-tier ad banner — sits under the header so it stays put while the
          composer + keyboard move. Hidden for Pro (any paid plan). */}
          <AdBanner style={{ marginHorizontal: 16, marginTop: 8 }} />

          <BubbleGradientContext.Provider value={bubbleGradient}>
            <View style={{ flex: 1 }}>
              <Animated.FlatList
                style={[contentFadeStyle, { flex: 1 }]}
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
            </View>
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
                locales). */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
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
                </ScrollView>
              </Animated.View>
            )}
          </View>

          <QuotaModal
            quota={quota}
            isTopTier={isTopTier}
            onUpgrade={openPlan}
            onDismiss={dismissQuota}
          />

          <RotLevelSheet
            ref={rotSheetRef}
            level={rotLevel}
            onChange={setRotLevel}
          />
        </KeyboardAvoidingView>
      </AttachmentViewerProvider>
    </ChatToneContext.Provider>
  );
}
