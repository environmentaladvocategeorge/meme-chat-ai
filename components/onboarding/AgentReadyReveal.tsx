// AgentReadyReveal
//
// Step 6's "my thing is ready" payoff. Plays a short sequence of fake-but-real
// loading lines (each reflecting an actual app feature) and then reveals the
// "Brainrot Bot is ready" card with its feature bullets. Calls onComplete once
// the reveal lands so the flow can enable the "enter the chaos" CTA. Styled with
// the app theme; entrances are opacity fades only.

import { MemeAvatar } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { CheckCircle, CircleNotch } from "phosphor-react-native";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

const STEP_MS = 700;

export function AgentReadyReveal({ onComplete }: { onComplete?: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const loading = t("onboarding.ready.loading", { returnObjects: true });
  const lines = Array.isArray(loading) ? (loading as string[]) : [];
  const bullets = t("onboarding.ready.bullets", { returnObjects: true });
  const bulletList = Array.isArray(bullets) ? (bullets as string[]) : [];

  // How many loading lines have "completed"; once it passes the list length we
  // flip to the revealed state.
  const [progress, setProgress] = useState(0);
  const revealed = progress > lines.length;
  const completedRef = useRef(false);

  useEffect(() => {
    if (lines.length === 0) {
      setProgress(1);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= lines.length + 1; i += 1) {
      timers.push(setTimeout(() => setProgress(i), STEP_MS * i));
    }
    return () => timers.forEach(clearTimeout);
  }, [lines.length]);

  useEffect(() => {
    if (revealed && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
  }, [revealed, onComplete]);

  if (revealed) {
    return (
      <Animated.View
        entering={FadeIn.duration(320)}
        style={{ alignItems: "center", gap: 16 }}
      >
        <MemeAvatar variant="cool" size={96} />
        <Typography
          family="display"
          weight="bold"
          style={{
            color: theme["--color-foreground"],
            fontSize: 24,
            lineHeight: 30,
            textAlign: "center",
          }}
        >
          {t("onboarding.ready.title")}
        </Typography>
        <Typography
          variant="body"
          style={{ color: theme["--color-foreground-secondary"], textAlign: "center" }}
        >
          {t("onboarding.ready.subtitle")}
        </Typography>
        <View style={{ width: "100%", gap: 8, marginTop: 4 }}>
          {bulletList.map((b) => (
            <Animated.View
              key={b}
              entering={FadeIn.duration(260)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 14,
                backgroundColor: theme["--color-card"],
                borderWidth: 1,
                borderColor: theme["--color-border"],
              }}
            >
              <CheckCircle size={20} color={theme["--color-primary"]} weight="fill" />
              <Typography
                variant="body"
                style={{ color: theme["--color-foreground"] }}
              >
                {b}
              </Typography>
            </Animated.View>
          ))}
        </View>
      </Animated.View>
    );
  }

  return (
    <View style={{ gap: 10, paddingTop: 8 }}>
      {lines.map((line, i) => {
        if (i > progress) return null;
        const isDone = i < progress;
        const isActive = i === progress;
        return (
          <Animated.View
            key={line}
            entering={FadeIn.duration(240)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: theme["--color-card"],
              borderWidth: 1,
              borderColor: theme["--color-border"],
            }}
          >
            {isDone ? (
              <CheckCircle size={20} color={theme["--color-primary"]} weight="fill" />
            ) : (
              <CircleNotch
                size={20}
                color={theme["--color-foreground-muted"]}
                weight="bold"
              />
            )}
            <Typography
              variant="body"
              style={{
                color: isActive
                  ? theme["--color-foreground"]
                  : theme["--color-foreground-secondary"],
                flex: 1,
              }}
            >
              {line}
            </Typography>
          </Animated.View>
        );
      })}
    </View>
  );
}
