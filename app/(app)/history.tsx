import { AppHeader } from "@/components/AppHeader";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import {
  subscribeToConversations,
  type ConversationSummary,
} from "@/services/firebase/conversations";
import { useAuthStore } from "@/store/auth";
import { useChatStore } from "@/store/chat";
import { useRouter } from "expo-router";
import { ChatCircleDots } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, View } from "react-native";

export default function HistoryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const uid = useAuthStore((s) => s.uid);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    if (!uid) {
      setConversations([]);
      return;
    }

    return subscribeToConversations(uid, setConversations);
  }, [uid]);

  const openConversation = (conversation: ConversationSummary) => {
    loadConversation(conversation.id);
    router.push({ pathname: "/chat", params: { conversationId: conversation.id } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <AppHeader title={t("history.title")} />
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 18,
          paddingTop: 18,
          paddingBottom: 28,
          gap: 10,
        }}
        ListEmptyComponent={
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <ChatCircleDots
              size={28}
              color={theme["--color-foreground-muted"]}
              weight="duotone"
            />
            <Typography
              variant="body"
              style={{
                color: theme["--color-foreground-muted"],
                textAlign: "center",
              }}
            >
              {t("history.empty")}
            </Typography>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => openConversation(item)}
            style={{
              borderRadius: 8,
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: theme["--color-card"],
              borderWidth: 1,
              borderColor: theme["--color-border"],
              gap: 5,
            }}
          >
            <Typography
              variant="title-sm"
              numberOfLines={1}
              style={{ color: theme["--color-foreground"] }}
            >
              {item.title || t("history.untitled")}
            </Typography>
            {item.lastMessagePreview.length > 0 ? (
              <Typography
                variant="caption"
                numberOfLines={2}
                style={{ color: theme["--color-foreground-secondary"] }}
              >
                {item.lastMessagePreview}
              </Typography>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
