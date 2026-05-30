// A compact, live preview of the chat look for the Customize Chat sheet. It
// renders the selected background with one agent bubble and one user bubble so
// the picked message style + background can be judged together at a glance.
// Driven by useChatAppearance, so it updates instantly as swatches are tapped.

import { AgentAvatar } from "@/components/AgentAvatar";
import { Typography } from "@/components/Typography";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { LinearGradient } from "expo-linear-gradient";
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
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
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
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
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
