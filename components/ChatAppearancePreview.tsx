// A compact, live preview of the chat look for the Customize Chat sheet. It
// renders the selected background with one agent bubble and one user bubble so
// the picked message style + background can be judged together at a glance.
// Driven by useChatAppearance, so it updates instantly as swatches are tapped.

import { AgentAvatar } from "@/components/AgentAvatar";
import { Typography } from "@/components/Typography";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { LinearGradient } from "expo-linear-gradient";
import { List, PaperPlaneTilt } from "phosphor-react-native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

const BUBBLE_RADIUS = 18;
const BUBBLE_TAIL_RADIUS = 5;
const AVATAR_SIZE = 28;

export function ChatAppearancePreview() {
  const { t } = useTranslation();
  const { bubble, background, chatTheme } = useChatAppearance();

  const userText = bubble.textColor;
  const agentBg = chatTheme["--color-card"];
  const agentText = chatTheme["--color-foreground"];

  return (
    <View
      style={{
        borderRadius: 16,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: chatTheme["--color-border"],
      }}
    >
      {/* Background layer (gradient or solid), with the messages laid on top. */}
      {background.kind === "gradient" && background.gradientColors ? (
        <LinearGradient
          colors={background.gradientColors}
          start={background.gradientStart ?? { x: 0, y: 0 }}
          end={background.gradientEnd ?? { x: 0, y: 1 }}
          style={{ ...StyleFill }}
        />
      ) : (
        <View
          style={{
            ...StyleFill,
            backgroundColor: background.color ?? chatTheme["--color-background"],
          }}
        />
      )}

      {/* Header preview. */}
      <View
        style={{
          marginHorizontal: 14,
          marginTop: 14,
          borderRadius: 18,
          paddingHorizontal: 10,
          paddingVertical: 8,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: chatTheme["--color-card"],
          borderWidth: 1,
          borderColor: chatTheme["--color-border"],
        }}
      >
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: chatTheme["--color-primary"],
          }}
        >
          <LinearGradient
            colors={[
              chatTheme["--color-primary"],
              chatTheme["--color-primary"],
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ ...StyleFill }}
          />
          <List
            size={15}
            weight="bold"
            color={chatTheme["--color-primary-foreground"]}
          />
        </View>
        <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 8 }}>
          <Typography
            variant="body"
            weight="bold"
            numberOfLines={1}
            style={{ color: chatTheme["--color-foreground"], fontSize: 15 }}
          >
            {t("chat.title")}
          </Typography>
        </View>
        <View
          style={{
            width: 30,
            height: 30,
          }}
        />
      </View>

      <View style={{ padding: 14, gap: 8 }}>
        {/* Agent bubble (left, with avatar). */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
            alignSelf: "flex-start",
            maxWidth: "85%",
          }}
        >
          <AgentAvatar size={AVATAR_SIZE} />
          <View
            style={{
              borderRadius: BUBBLE_RADIUS,
              borderBottomLeftRadius: BUBBLE_TAIL_RADIUS,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: agentBg,
            }}
          >
            <Typography
              variant="body-sm"
              style={{ color: agentText, fontSize: 14, lineHeight: 19 }}
            >
              {t("settings.customization.previewAgent")}
            </Typography>
          </View>
        </View>

        {/* User bubble (right) — the actual selected message style. */}
        <View
          style={{
            borderRadius: BUBBLE_RADIUS,
            borderBottomRightRadius: BUBBLE_TAIL_RADIUS,
            overflow: "hidden",
            alignSelf: "flex-end",
            maxWidth: "85%",
            backgroundColor:
              bubble.kind === "solid"
                ? (bubble.solidColor ?? undefined)
                : undefined,
          }}
        >
          {bubble.kind === "gradient" && bubble.gradientColors ? (
            <LinearGradient
              colors={bubble.gradientColors}
              start={bubble.gradientStart ?? { x: 0, y: 0 }}
              end={bubble.gradientEnd ?? { x: 0, y: 1 }}
              style={{ ...StyleFill }}
            />
          ) : null}
          <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <Typography
              variant="body-sm"
              style={{ color: userText, fontSize: 14, lineHeight: 19 }}
            >
              {t("settings.customization.previewUser")}
            </Typography>
          </View>
        </View>
      </View>

      {/* Chat bar preview. */}
      <View
        style={{
          marginHorizontal: 14,
          marginBottom: 14,
          height: 38,
          borderRadius: 19,
          paddingLeft: 14,
          paddingRight: 5,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: chatTheme["--color-input"],
          borderWidth: 1,
          borderColor: chatTheme["--color-border"],
        }}
      >
        <Typography
          variant="body-sm"
          numberOfLines={1}
          style={{
            flex: 1,
            color: chatTheme["--color-foreground-muted"],
            fontSize: 13,
          }}
        >
          {t("settings.customization.previewPlaceholder")}
        </Typography>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: chatTheme["--color-primary"],
          }}
        >
          <PaperPlaneTilt
            size={13}
            weight="fill"
            color={chatTheme["--color-primary-foreground"]}
          />
        </View>
      </View>
    </View>
  );
}

const StyleFill = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
