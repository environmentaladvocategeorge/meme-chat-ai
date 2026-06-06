// RotLevelDemo
//
// The interactive moment of onboarding: the same prompt, three tones. Tapping a
// rot level swaps the answer text with a fade and reports the chosen level up to
// the flow. Levels map to the app's 1–3 rot dial so the selection seeds the real
// chat preference. Styled with the app theme surfaces.

import { AppPressable } from "@/components/AppPressable";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

// Display order + their rot-dial value (1 = lightly cooked … 3 = goblin).
const LEVELS = [
  { key: "lightlyCooked", value: 1 },
  { key: "rotted", value: 2 },
  { key: "goblin", value: 3 },
] as const;

export function RotLevelDemo({
  value,
  onChange,
}: {
  value: number;
  onChange: (level: number) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const selected = LEVELS.find((l) => l.value === value) ?? LEVELS[1];

  return (
    <View style={{ gap: 16 }}>
      {/* Prompt chip — the fixed question every tone answers. */}
      <View
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 16,
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      >
        <Typography variant="body" style={{ color: theme["--color-foreground"] }}>
          {t("onboarding.rot.prompt")}
        </Typography>
      </View>

      {/* The three selectable tones. */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {LEVELS.map((level) => {
          const active = level.value === selected.value;
          return (
            <AppPressable
              key={level.key}
              onPress={() => onChange(level.value)}
              haptic
              pressScale={0.04}
              accessibilityLabel={t(`onboarding.rot.levels.${level.key}.label`)}
              accessibilityState={{ selected: active }}
              containerStyle={{ flex: 1 }}
              style={{
                alignItems: "center",
                gap: 6,
                paddingVertical: 12,
                borderRadius: 16,
                // Neutral grey fill, not a teal "primary-subtle" wash (reads as
                // generic AI UI). The teal border + bold teal label carry the
                // selected state.
                backgroundColor: active
                  ? theme["--color-card-muted"]
                  : theme["--color-card"],
                borderWidth: active ? 1.5 : 1,
                borderColor: active
                  ? theme["--color-primary"]
                  : theme["--color-border"],
              }}
            >
              <Typography style={{ fontSize: 26, lineHeight: 30 }}>
                {t(`onboarding.rot.levels.${level.key}.emoji`)}
              </Typography>
              <Typography
                variant="caption"
                style={{
                  color: active
                    ? theme["--color-primary"]
                    : theme["--color-foreground-secondary"],
                  fontWeight: active ? "700" : "500",
                  textAlign: "center",
                }}
                numberOfLines={2}
              >
                {t(`onboarding.rot.levels.${level.key}.label`)}
              </Typography>
            </AppPressable>
          );
        })}
      </View>

      {/* The answer, fading on every selection (key drives remount). */}
      <Animated.View
        key={selected.key}
        entering={FadeIn.duration(240)}
        style={{
          padding: 14,
          borderRadius: 18,
          borderBottomLeftRadius: 6,
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      >
        <Typography variant="body" style={{ color: theme["--color-foreground"] }}>
          {t(`onboarding.rot.levels.${selected.key}.answer`)}
        </Typography>
      </Animated.View>
    </View>
  );
}
