// OnboardingScaffold
//
// Shared chrome for the post-signup onboarding flow. Uses the real app theme
// surfaces (background, cards, primary button) rather than a one-off gradient,
// so onboarding looks and feels like the rest of the app. Adds the three pieces
// every step needs: a progress-dots row, a scrollable content area, and a
// footer with the app's primary Button plus an optional small secondary action.
// Entrances are simple opacity fades only — no spring/jitter.

import { Button } from "@/components/Button";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { CaretLeft } from "phosphor-react-native";
import { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

interface OnboardingScaffoldProps {
  step: number; // zero-based index of the current step
  total: number; // total step count, for the progress dots
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  // Primary CTA. Optional: the paywall step omits it and relies on PlanPaywall's
  // own purchase button, surfacing only the secondary action.
  ctaLabel?: string;
  onCta?: () => void;
  ctaLoading?: boolean;
  ctaDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onBack?: () => void;
}

export function OnboardingScaffold({
  step,
  total,
  title,
  subtitle,
  children,
  ctaLabel,
  onCta,
  ctaLoading,
  ctaDisabled,
  secondaryLabel,
  onSecondary,
  onBack,
}: OnboardingScaffoldProps) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const hasHeading = Boolean(title) || Boolean(subtitle);

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />

      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <View
            style={{
              flex: 1,
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 14,
            }}
          >
            {/* Header: optional back + progress dots */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                height: 40,
              }}
            >
              {onBack ? (
                <Pressable
                  onPress={onBack}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  hitSlop={12}
                  style={({ pressed }) => ({
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme["--color-card-muted"],
                    borderWidth: 1,
                    borderColor: theme["--color-border"],
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <CaretLeft
                    size={20}
                    color={theme["--color-foreground"]}
                    weight="bold"
                  />
                </Pressable>
              ) : null}
              <ProgressDots
                step={step}
                total={total}
                activeColor={theme["--color-primary"]}
                inactiveColor={theme["--color-border"]}
              />
            </View>

            {/* Title + subtitle */}
            {hasHeading ? (
              <Animated.View
                entering={FadeIn.duration(260)}
                style={{ gap: 8, marginTop: 16, marginBottom: 16 }}
              >
                {title ? (
                  <Typography
                    family="display"
                    weight="bold"
                    style={{
                      color: theme["--color-foreground"],
                      fontSize: 26,
                      lineHeight: 32,
                    }}
                  >
                    {title}
                  </Typography>
                ) : null}
                {subtitle ? (
                  <Typography
                    variant="body"
                    style={{ color: theme["--color-foreground-secondary"] }}
                  >
                    {subtitle}
                  </Typography>
                ) : null}
              </Animated.View>
            ) : (
              <View style={{ height: 8 }} />
            )}

            {/* Scrollable content */}
            <Animated.View entering={FadeIn.duration(260)} style={{ flex: 1 }}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 12, gap: 16 }}
              >
                {children}
              </ScrollView>
            </Animated.View>

            {/* Footer CTA + optional small secondary */}
            <View style={{ gap: 4, marginTop: 10 }}>
              {ctaLabel ? (
                <Button
                  title={ctaLabel}
                  onPress={onCta ?? (() => {})}
                  loading={ctaLoading}
                  disabled={ctaDisabled}
                  style={{ height: 52, borderRadius: 16 }}
                />
              ) : null}
              {secondaryLabel ? (
                <Pressable
                  onPress={onSecondary}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    paddingVertical: 10,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Typography
                    variant="caption"
                    style={{ color: theme["--color-foreground-muted"] }}
                  >
                    {secondaryLabel}
                  </Typography>
                </Pressable>
              ) : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function ProgressDots({
  step,
  total,
  activeColor,
  inactiveColor,
}: {
  step: number;
  total: number;
  activeColor: string;
  inactiveColor: string;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 6, flex: 1 }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            height: 4,
            flex: 1,
            borderRadius: 99,
            backgroundColor: i <= step ? activeColor : inactiveColor,
          }}
        />
      ))}
    </View>
  );
}
