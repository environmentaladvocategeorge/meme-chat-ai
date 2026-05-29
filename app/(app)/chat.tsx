import { AgentAvatar } from "@/components/AgentAvatar";
import { AppHeader } from "@/components/AppHeader";
import { ChatInput } from "@/components/ChatInput";
import { MemeAvatar } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { planAllowsAdvanced } from "@/domain/billing";
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
import { NotePencil, X } from "phosphor-react-native";
import { useColorScheme } from "nativewind";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-native-markdown-display";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type RenderMessage = ChatMessage & { retry?: boolean; thinking?: boolean };

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

export default function ChatScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const [draft, setDraft] = useState("");
  const conversationId = useChatStore((s) => s.conversationId);
  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const activeReplyClientId = useChatStore((s) => s.activeReplyClientId);
  const settledReply = useChatStore((s) => s.settledReply);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const quota = useChatStore((s) => s.quota);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const startNewConversation = useChatStore((s) => s.startNewConversation);
  const cancelStreaming = useChatStore((s) => s.cancelStreaming);
  const dismissQuota = useChatStore((s) => s.dismissQuota);
  const entitlement = useEntitlementStore((s) => s.entitlement);
  const currentPlan = useDisplayPlan();
  const openPlan = useOpenPlan();
  const router = useRouter();
  const [advanced, setAdvanced] = useState(false);
  const advancedAllowed = entitlement
    ? planAllowsAdvanced(entitlement.plan)
    : false;

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

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "user"),
    [messages],
  );

  const visibleMessages = useMemo<RenderMessage[]>(() => {
    // Drop empty placeholders, but keep errored agent bubbles so the user
    // sees the failure state.
    const base: RenderMessage[] = messages
      .filter(
        (message) =>
          message.text.length > 0 ||
          (message.role === "agent" && message.status === "error"),
      )
      .map((message) => ({
        ...message,
        retry:
          status === "error" &&
          message.role === "user" &&
          message.id === lastUserMessage?.id,
      }));

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
        status: "streaming",
        createdAt: null,
        thinking: streamingText.length === 0,
      });
    } else if (settledReply) {
      // Bridge: the stream is done but the finalized Firestore message
      // hasn't arrived in the snapshot yet. Only synthesize it if the real
      // one isn't already present, so we never double-render.
      const alreadyStored = base.some(
        (message) =>
          message.role === "agent" &&
          message.inReplyToClientMessageId === settledReply.clientMessageId &&
          message.text.length > 0,
      );
      if (!alreadyStored) {
        base.push({
          id: `agent:${settledReply.clientMessageId}`,
          role: "agent",
          inReplyToClientMessageId: settledReply.clientMessageId,
          text: settledReply.text,
          status: "complete",
          createdAt: null,
        });
      }
    }

    return base.reverse();
  }, [
    activeReplyClientId,
    lastUserMessage?.id,
    messages,
    settledReply,
    status,
    streamingText,
  ]);

  const handleSubmit = () => {
    if (atLimit) return;
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
    void sendMessage(text, { advanced: advancedAllowed && advanced });
  };

  const handleStarterPress = (text: string) => {
    if (atLimit) return;
    setDraft("");
    void sendMessage(text, { advanced: advancedAllowed && advanced });
  };

  const handleRetry = () => {
    if (!lastUserMessage) return;
    void sendMessage(lastUserMessage.text, {
      advanced: advancedAllowed && advanced,
    });
  };

  // Drives the cross-fade when starting a new chat: fade the current thread
  // out, swap in the fresh empty state, then fade that back in.
  const contentOpacity = useSharedValue(1);
  const contentFadeStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  const handleNewConversation = () => {
    const reset = () => {
      startNewConversation();
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

      <Animated.FlatList
        style={contentFadeStyle}
        inverted
        data={visibleMessages}
        keyExtractor={messageKey}
        keyboardShouldPersistTaps="handled"
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
            thinkingLabel={t("chat.thinking")}
            onRetry={handleRetry}
          />
        )}
      />

      {error ? (
        <Typography
          variant="caption"
          style={{
            color: theme["--color-error"],
            paddingHorizontal: 18,
            paddingBottom: 8,
          }}
        >
          {error === "signed-out"
            ? t("chat.errors.signedOut")
            : t("chat.errors.generic")}
        </Typography>
      ) : null}

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
            {advancedAllowed ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingBottom: 8,
                }}
              >
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Typography
                    variant="caption"
                    style={{
                      color: theme["--color-foreground"],
                      fontWeight: "600",
                    }}
                  >
                    {t("chat.advanced.toggle")}
                  </Typography>
                  <Typography
                    variant="caption"
                    style={{
                      color: theme["--color-foreground-muted"],
                      marginTop: 2,
                    }}
                  >
                    {t("chat.advanced.hint")}
                  </Typography>
                </View>
                <Switch value={advanced} onValueChange={setAdvanced} />
              </View>
            ) : null}
            <ChatInput
              value={draft}
              onChangeText={setDraft}
              onSend={handleSubmit}
              onCancel={cancelStreaming}
              streaming={status === "streaming"}
              placeholder={t("chat.input.placeholder")}
              sendAccessibilityLabel={t("chat.send")}
              cancelAccessibilityLabel={t("chat.cancel")}
              expandAccessibilityLabel={t("chat.expand")}
              collapseAccessibilityLabel={t("chat.collapse")}
            />
          </Animated.View>
        )}
      </View>

      <QuotaModal
        quota={quota}
        isTopTier={isTopTier}
        onUpgrade={openPlan}
        onDismiss={dismissQuota}
      />
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

const STARTER_COUNT = 4;

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
      <View
        style={{
          alignItems: "center",
          gap: 12,
          width: "100%",
          maxWidth: 420,
        }}
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
            {t(atLimit ? "chat.empty.atTitle" : "chat.empty.title")}
          </Typography>
          <Typography
            variant="body"
            style={{
              color: theme["--color-foreground-muted"],
              textAlign: "center",
              maxWidth: 330,
            }}
          >
            {t(atLimit ? "chat.empty.atSubtitle" : "chat.empty.subtitle")}
          </Typography>
        </View>

        {!atLimit ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "center",
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
      </View>
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
    <Animated.View style={[{ width: "47%", maxWidth: 196 }, animatedStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text}
        onPress={handlePress}
        style={({ pressed: isPressed }) => ({
          minHeight: 68,
          borderRadius: 16,
          paddingHorizontal: 13,
          paddingVertical: 12,
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
      case "advanced":
        return t("chat.quota.advanced", { date: dateLabel });
      case "advanced_disabled":
        return t("chat.quota.advanced_disabled");
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
}: {
  message: RenderMessage;
  retryLabel: string;
  errorLabel: string;
  thinkingLabel: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const primaryGradient = gradients[colorScheme ?? "light"].primary;
  const mine = message.role === "user";
  const errored = message.status === "error";
  const thinking = message.thinking === true;
  const useGradient = mine && !errored;
  const timestampLabel = formatMessageTimestamp(message.createdAt);
  const [showTimestamp, setShowTimestamp] = useState(false);

  const messageText =
    errored && message.text.length === 0 ? errorLabel : message.text;

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
          marginBottom: 0,
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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            timestampLabel ? `${messageText}. ${timestampLabel}` : messageText
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
            <LinearGradient
              colors={primaryGradient.colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          ) : null}
          {thinking ? (
            <Typography
              variant="body-lg"
              style={{ color: theme["--color-foreground-muted"] }}
            >
              {thinkingLabel}
            </Typography>
          ) : (
            <Markdown style={markdownStyles}>{messageText}</Markdown>
          )}
        </Pressable>
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

      {message.retry ? (
        <View
          style={{
            paddingLeft: AVATAR_SIZE + AVATAR_GUTTER,
            alignItems: "flex-end",
          }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 8,
              backgroundColor: theme["--color-background-secondary"],
            }}
          >
            <Typography
              variant="caption"
              style={{ color: theme["--color-primary"], fontWeight: "700" }}
            >
              {retryLabel}
            </Typography>
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  );
}
