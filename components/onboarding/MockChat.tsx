// MockChat
//
// Lightweight, presentational mock of the real chat thread used across the
// onboarding showcase steps. Not the production MessageBubble (which is wired to
// the live store), but styled with the same theme surfaces so it reads as the
// real app: user bubbles use the primary gradient, bot bubbles use the card
// surface with the AgentAvatar. Real GIF attachments are rendered through the
// app's own MessageGifAttachments (expo-image + KLIPY watermark).

import { AgentAvatar } from "@/components/AgentAvatar";
import { MessageGifAttachments } from "@/components/MessageGifAttachments";
import { Typography } from "@/components/Typography";
import type { MessageGif } from "@/domain/gifs";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { ActivityIndicator, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

export interface MockMessage {
  id: string;
  from: "user" | "bot";
  text?: string;
  gif?: MessageGif | null;
  // When true and no gif is present yet, render a sized skeleton (GIF still
  // loading from the trending API) so the layout doesn't jump.
  gifLoading?: boolean;
}

export function MockChat({
  messages,
  gifLabel,
}: {
  messages: MockMessage[];
  gifLabel: string;
}) {
  const theme = useTheme();

  return (
    <View
      style={{
        borderRadius: 22,
        padding: 14,
        gap: 14,
        backgroundColor: theme["--color-card-muted"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
      }}
    >
      {messages.map((m, i) => (
        <MockRow key={m.id} message={m} index={i} gifLabel={gifLabel} />
      ))}
    </View>
  );
}

function MockRow({
  message,
  index,
  gifLabel,
}: {
  message: MockMessage;
  index: number;
  gifLabel: string;
}) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const primary = gradients[colorScheme ?? "light"].primary;
  const mine = message.from === "user";

  return (
    <Animated.View
      entering={FadeIn.duration(280).delay(120 + index * 140)}
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
        {message.text ? (
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
                {message.text}
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
                {message.text}
              </Typography>
            </View>
          )
        ) : null}

        {message.gif ? (
          <MessageGifAttachments
            gifs={[message.gif]}
            align={mine ? "end" : "start"}
            gifLabel={gifLabel}
          />
        ) : message.gifLoading ? (
          <View
            style={{
              width: 150,
              height: 150,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme["--color-card"],
              borderWidth: 1,
              borderColor: theme["--color-border"],
            }}
          >
            <ActivityIndicator color={theme["--color-foreground-muted"]} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}
