// OnboardingChat
//
// The conversational onboarding surface. Styled to read as the real /chat
// thread (agent pill header, bot/user bubbles with the agent avatar, watermarked
// GIFs) but driven by the scripted engine (useOnboardingScript) instead of the
// live chat store. Owns only presentation + input affordances; business logic
// (notification permission, paywall, finishing) is injected by the host so this
// component stays free of side effects.

import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/Button";
import { MessageGifAttachments } from "@/components/MessageGifAttachments";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import type { TranscriptEntry, TurnId } from "@/domain/onboarding/script";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { onboardingGif } from "./onboardingGifs";
import { ComposerSkip, OnboardingComposer } from "./OnboardingComposer";
import { useOnboardingScript } from "./useOnboardingScript";
import { MAX_ALIAS_LENGTH } from "@/store/storage";

export function OnboardingChat({
  onBeforeAdvance,
  onReachedPaywall,
}: {
  // Fired right before the engine advances a turn, so the host can run that
  // turn's side effect (notification permission soft-ask on the notif turn).
  onBeforeAdvance?: (turnId: TurnId, value: string) => void;
  // Fired once the scripted conversation reaches its terminal (paywall) turn, so
  // the host can hand off to the full-screen paywall. The paywall is a full
  // purchase UI (all tiers, no scroll) and doesn't belong inside a chat bubble.
  onReachedPaywall: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();

  const { transcript, currentTurn, phase, cursorIndex, total, submit } =
    useOnboardingScript();

  // Hand off to the host's full-screen paywall the moment the conversation
  // reaches its terminal turn. Fired once; the host then unmounts this chat.
  const reachedPaywallRef = useRef(false);
  useEffect(() => {
    if (currentTurn.kind === "paywall" && !reachedPaywallRef.current) {
      reachedPaywallRef.current = true;
      onReachedPaywall();
    }
  }, [currentTurn, onReachedPaywall]);

  const scrollRef = useRef<ScrollView>(null);
  // Keep the latest bubble + the typing indicator in view as the conversation grows.
  useEffect(() => {
    const id = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      50,
    );
    return () => clearTimeout(id);
  }, [transcript.length, phase]);

  // When the composer opens on the name turn, the keyboard shrinks the viewport
  // and would otherwise hide the question being asked. Scroll to the end once the
  // keyboard finishes animating in so the latest bubbles stay visible above it.
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  const gifLabel = t("onboarding.chat.gifLabel");

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <ChatHeader step={cursorIndex} total={total} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: 16,
              paddingBottom: 8,
              gap: 12,
            }}
          >
            {transcript.map((entry) => (
              <Bubble key={entry.id} entry={entry} gifLabel={gifLabel} />
            ))}
            {phase === "typing" ? <TypingBubble /> : null}
          </ScrollView>

          {/* Input zone: swaps per turn. Hidden while the bot is typing. */}
          <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
            {phase === "awaiting" && currentTurn.kind !== "paywall" ? (
              currentTurn.kind === "text" ? (
                <NameInput
                  placeholder={t(currentTurn.placeholderKey)}
                  skipLabel={t(currentTurn.skip.labelKey)}
                  onSend={(name) => {
                    onBeforeAdvance?.("name", name);
                    submit({ value: "name", literal: name });
                  }}
                  onSkip={() => {
                    onBeforeAdvance?.("name", "");
                    submit({ value: "skip" });
                  }}
                />
              ) : (
                <ChipRow
                  options={currentTurn.options.map((o) => ({
                    value: o.value,
                    label: t(o.labelKey),
                  }))}
                  onPick={(value) => {
                    onBeforeAdvance?.(currentTurn.id, value);
                    submit({ value });
                  }}
                />
              )
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// A minimal chat-style header: the agent identity pill + a thin progress bar.
// Deliberately NOT the app's AppHeader (which carries the global menu button) —
// onboarding is a focused flow with no navigation out.
function ChatHeader({ step, total }: { step: number; total: number }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, gap: 10 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <AgentAvatar size={26} />
        <Typography
          variant="body"
          weight="semibold"
          style={{ color: theme["--color-foreground"], fontSize: 15 }}
        >
          {t("chat.agentName")}
        </Typography>
      </View>
      <ProgressBar step={step} total={total} />
    </View>
  );
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  const theme = useTheme();
  // Fill through the conversation; the terminal paywall turn reads as "full".
  const ratio = total > 1 ? Math.min(step / (total - 1), 1) : 1;
  return (
    <View
      style={{
        height: 4,
        borderRadius: 99,
        backgroundColor: theme["--color-border"],
        overflow: "hidden",
      }}
    >
      <View
        style={{
          height: "100%",
          width: `${Math.round(ratio * 100)}%`,
          borderRadius: 99,
          backgroundColor: theme["--color-primary"],
        }}
      />
    </View>
  );
}

function Bubble({
  entry,
  gifLabel,
}: {
  entry: TranscriptEntry;
  gifLabel: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const primary = gradients[colorScheme ?? "light"].primary;
  const mine = entry.role === "user";

  // Resolve the bubble text: a literal typed value, or a localized key (with
  // optional interpolation vars), or nothing for a GIF-only bubble.
  const text =
    entry.literal !== undefined
      ? entry.literal
      : entry.textKey
        ? t(entry.textKey, entry.vars)
        : "";
  const gif = entry.gifId ? onboardingGif(entry.gifId) : null;

  return (
    <Animated.View
      entering={FadeIn.duration(240)}
      style={{
        flexDirection: "row",
        justifyContent: mine ? "flex-end" : "flex-start",
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      {!mine ? <AgentAvatar size={28} /> : null}
      <View
        style={{
          maxWidth: "82%",
          gap: 8,
          alignItems: mine ? "flex-end" : "flex-start",
        }}
      >
        {text ? (
          mine ? (
            <LinearGradient
              colors={primary.colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 18,
                borderBottomRightRadius: 6,
              }}
            >
              <Typography variant="body" style={{ color: "#FFFFFF" }}>
                {text}
              </Typography>
            </LinearGradient>
          ) : (
            <View
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 18,
                borderBottomLeftRadius: 6,
                backgroundColor: theme["--color-card"],
                borderWidth: 1,
                borderColor: theme["--color-border"],
              }}
            >
              <Typography
                variant="body"
                style={{ color: theme["--color-foreground"] }}
              >
                {text}
              </Typography>
            </View>
          )
        ) : null}

        {gif ? (
          <MessageGifAttachments
            gifs={[gif]}
            align={mine ? "end" : "start"}
            gifLabel={gifLabel}
          />
        ) : null}
      </View>
    </Animated.View>
  );
}

// The bot "typing" bubble: three pulsing dots in a bot-styled card, shown while
// the engine composes the next line.
function TypingBubble() {
  const theme = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}
    >
      <AgentAvatar size={28} />
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderRadius: 18,
          borderBottomLeftRadius: 6,
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
          flexDirection: "row",
          gap: 5,
        }}
      >
        {[0, 1, 2].map((i) => (
          <TypingDot key={i} index={i} />
        ))}
      </View>
    </Animated.View>
  );
}

function TypingDot({ index }: { index: number }) {
  const theme = useTheme();
  return (
    <Animated.View
      entering={FadeIn.delay(index * 120).duration(400)}
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: theme["--color-foreground-muted"],
        opacity: 0.6,
      }}
    />
  );
}

// The free-text name turn: composer + skip, with its own local draft state so
// the parent doesn't re-render on every keystroke.
function NameInput({
  placeholder,
  skipLabel,
  onSend,
  onSkip,
}: {
  placeholder: string;
  skipLabel: string;
  onSend: (name: string) => void;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <View style={{ gap: 6 }}>
      <OnboardingComposer
        value={draft}
        onChangeText={setDraft}
        onSubmit={() => {
          const name = draft.trim();
          if (name.length > 0) onSend(name);
        }}
        placeholder={placeholder}
        maxLength={MAX_ALIAS_LENGTH}
        autoFocus
      />
      <ComposerSkip label={skipLabel} onPress={onSkip} />
    </View>
  );
}

// Quick-reply chips for a question turn. A single advance-only option (greet /
// ready) renders as a prominent primary CTA instead of a chip.
function ChipRow({
  options,
  onPick,
}: {
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  const theme = useTheme();

  if (options.length === 1) {
    return (
      <Button
        title={options[0].label}
        onPress={() => onPick(options[0].value)}
        style={{ height: 52, borderRadius: 16 }}
      />
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: 8,
      }}
    >
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onPick(o.value)}
          accessibilityRole="button"
          accessibilityLabel={o.label}
          hitSlop={6}
          style={({ pressed }) => ({
            paddingHorizontal: 16,
            paddingVertical: 11,
            borderRadius: 999,
            // Neutral surface with an accent edge — reads as tappable without the
            // washed-out subtle tint.
            backgroundColor: theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-primary-muted"],
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Typography
            variant="body-sm"
            weight="semibold"
            style={{ color: theme["--color-foreground"] }}
          >
            {o.label}
          </Typography>
        </Pressable>
      ))}
    </View>
  );
}
