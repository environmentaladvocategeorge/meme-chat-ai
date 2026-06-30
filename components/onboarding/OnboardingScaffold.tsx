// OnboardingScaffold
//
// Chrome for the final onboarding paywall screen (the conversational flow hands
// off here after the user taps "enter the chaos"). The whole page is one scroll
// view — title, the PlanPaywall, and the secondary action all scroll together —
// so nothing is clipped on shorter devices. There is no progress indicator: the
// scripted chat owns onboarding progress now, and this is the last step.

import { AppPressable } from "@/components/AppPressable";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { CaretLeft } from "phosphor-react-native";
import { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

interface OnboardingScaffoldProps {
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
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 14,
          }}
        >
          {/* Optional back affordance (unused by the paywall, kept for reuse). */}
          {onBack ? (
            <View style={{ height: 40, justifyContent: "center" }}>
              <IconButton
                onPress={onBack}
                accessibilityLabel="Back"
                hitSlop={12}
                size={38}
                glass
                fallbackStyle={{
                  backgroundColor: theme["--color-card-muted"],
                  borderWidth: 1,
                  borderColor: theme["--color-border"],
                }}
              >
                <CaretLeft
                  size={20}
                  color={theme["--color-foreground"]}
                  weight="bold"
                />
              </IconButton>
            </View>
          ) : null}

          {hasHeading ? (
            <Animated.View
              entering={FadeIn.duration(260)}
              style={{ gap: 8, marginTop: 8, marginBottom: 16 }}
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
          ) : null}

          {/* Main content (PlanPaywall). */}
          <Animated.View entering={FadeIn.duration(260)} style={{ gap: 16 }}>
            {children}
          </Animated.View>

          {/* Footer actions. marginTop:auto floats them to the bottom when the
              content is short, but they scroll with everything once it overflows. */}
          <View style={{ gap: 4, marginTop: "auto", paddingTop: 16 }}>
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
              <AppPressable
                onPress={onSecondary}
                feedback="opacity"
                hitSlop={8}
                accessibilityLabel={secondaryLabel}
                style={{ alignItems: "center", paddingVertical: 10 }}
              >
                <Typography
                  variant="caption"
                  style={{ color: theme["--color-foreground-muted"] }}
                >
                  {secondaryLabel}
                </Typography>
              </AppPressable>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
