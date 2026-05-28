import { AppHeader } from "@/components/AppHeader";
import { ChatInput } from "@/components/ChatInput";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { useChatStore, type ChatMessage } from "@/store/chat";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type RenderMessage = ChatMessage & { retry?: boolean };

export default function ChatScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const [draft, setDraft] = useState("");
  const conversationId = useChatStore((s) => s.conversationId);
  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const cancelStreaming = useChatStore((s) => s.cancelStreaming);

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
    const filtered = messages.filter(
      (message) =>
        message.text.length > 0 ||
        (message.role === "agent" && message.status === "error"),
    );
    const withRetry: RenderMessage[] = filtered.map((message) => ({
      ...message,
      retry:
        status === "error" &&
        message.role === "user" &&
        message.id === lastUserMessage?.id,
    }));

    if (status === "streaming" && streamingText.length > 0) {
      withRetry.push({
        id: "streaming-agent",
        role: "agent",
        text: streamingText,
        status: "streaming",
      });
    }

    return withRetry.reverse();
  }, [lastUserMessage?.id, messages, status, streamingText]);

  const handleSubmit = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
    void sendMessage(text);
  };

  const handleRetry = () => {
    if (!lastUserMessage) return;
    void sendMessage(lastUserMessage.text);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme["--color-background"] }}
    >
      <AppHeader title={t("chat.title")} />
      <FlatList
        inverted
        data={visibleMessages}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: visibleMessages.length === 0 ? "center" : "flex-start",
          paddingHorizontal: 18,
          paddingTop: 16,
          paddingBottom: 18,
          gap: 10,
        }}
        ListEmptyComponent={
          // The FlatList is `inverted`, which applies a vertical flip to
          // ALL its content — including this empty component. We counter
          // it with the inverse transform so the text reads right-side up.
          <View style={{ transform: [{ scaleY: -1 }] }}>
            <Typography
              variant="body"
              style={{
                color: theme["--color-foreground-muted"],
                textAlign: "center",
              }}
            >
              {t("chat.empty")}
            </Typography>
          </View>
        }
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            retryLabel={t("common.retry")}
            errorLabel={t("chat.errors.generic")}
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
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({
  message,
  retryLabel,
  errorLabel,
  onRetry,
}: {
  message: RenderMessage;
  retryLabel: string;
  errorLabel: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const primaryGradient = gradients[colorScheme ?? "light"].primary;
  const mine = message.role === "user";
  const errored = message.status === "error";
  // The user's outgoing bubble uses a vertical (top → bottom) version of
  // the primary brand gradient. We reuse the gradient's colors but force
  // the direction to vertical so the bubble reads as a gentle gradient,
  // not the diagonal sweep we use on heavier surfaces (CTAs, send button).
  const useGradient = mine && !errored;

  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start", gap: 6 }}>
      <View
        style={{
          maxWidth: "82%",
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 9,
          overflow: "hidden",
          backgroundColor: useGradient
            ? "transparent"
            : errored
              ? theme["--color-error-muted"]
              : theme["--color-card"],
          borderWidth: mine ? 0 : 1,
          borderColor: errored
            ? theme["--color-error"]
            : theme["--color-border"],
        }}
      >
        {useGradient ? (
          <LinearGradient
            colors={primaryGradient.colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        ) : null}
        <Typography
          variant="body"
          style={{
            color: mine
              ? theme["--color-primary-foreground"]
              : errored
                ? theme["--color-error"]
                : theme["--color-foreground"],
          }}
        >
          {errored && message.text.length === 0 ? errorLabel : message.text}
        </Typography>
      </View>

      {message.retry ? (
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
      ) : null}
    </View>
  );
}
