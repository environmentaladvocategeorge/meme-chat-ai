// AuthScaffold
//
// Shared chrome for the logged-out auth screens (create account / sign in /
// verify email). Carries the same brand identity as the landing page — the
// saturated blue→purple→pink gradient — but dialed back: no mascot or chat
// preview, just the gradient (rendered statically so it doesn't stutter against
// the screen transition), a dark veil for legibility, a white display title,
// and the screen's fields.
//
// Pair it with the glass-toned <Input tone="glass" /> and the <GradientButton>
// exported here so form controls read cleanly over the gradient.

import { Typography } from "@/components/Typography";
import { gradients } from "@/nativewind-theme";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { CaretLeft, type IconProps } from "phosphor-react-native";
import { ComponentType, ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

interface AuthScaffoldProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: ReactNode;
}

export function AuthScaffold({
  title,
  subtitle,
  onBack,
  children,
}: AuthScaffoldProps) {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? "light";
  const brand = gradients[scheme].brand;
  const veil =
    scheme === "dark"
      ? (["rgba(11,7,20,0)", "rgba(11,7,20,0.6)", "rgba(11,7,20,0.94)"] as const)
      : (["rgba(8,5,24,0)", "rgba(8,5,24,0.5)", "rgba(10,6,28,0.86)"] as const);

  return (
    <View style={{ flex: 1, backgroundColor: "#0B0714" }}>
      <StatusBar style="light" />

      <LinearGradient
        colors={brand.colors}
        locations={brand.locations}
        start={brand.start}
        end={brand.end}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={veil}
        locations={[0, 0.5, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <View
            style={{
              flex: 1,
              paddingHorizontal: 24,
              paddingTop: 8,
              paddingBottom: 24,
            }}
          >
            {onBack ? (
              <Animated.View entering={FadeIn.duration(500)}>
                <Pressable
                  onPress={onBack}
                  accessibilityRole="button"
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.back,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <CaretLeft size={22} color="#FFFFFF" weight="bold" />
                </Pressable>
              </Animated.View>
            ) : null}

            <Animated.View
              entering={FadeIn.duration(450).delay(120)}
              style={{ gap: 8, marginTop: onBack ? 18 : 8, marginBottom: 28 }}
            >
              <Typography
                family="display"
                weight="bold"
                style={styles.title}
              >
                {title}
              </Typography>
              {subtitle ? (
                <Typography variant="body-lg" style={styles.subtitle}>
                  {subtitle}
                </Typography>
              ) : null}
            </Animated.View>

            <Animated.View
              entering={FadeIn.duration(450).delay(220)}
              style={{ flex: 1 }}
            >
              {children}
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

interface GradientButtonProps {
  title: string;
  onPress: () => void;
  variant?: "accent" | "glass";
  startIcon?: ComponentType<IconProps>;
  loading?: boolean;
  disabled?: boolean;
}

export function GradientButton({
  title,
  onPress,
  variant = "accent",
  startIcon: StartIcon,
  loading,
  disabled,
}: GradientButtonProps) {
  const isAccent = variant === "accent";
  const fg = isAccent ? "#1A1206" : "#FFFFFF";
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      style={({ pressed }) => [
        styles.button,
        isAccent
          ? {
              shadowColor: "#FF9A3A",
              shadowOpacity: 0.5,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 10,
            }
          : {
              backgroundColor: "rgba(255,255,255,0.12)",
              borderWidth: 1.5,
              borderColor: "rgba(255,255,255,0.4)",
            },
        {
          opacity: isDisabled ? 0.45 : pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      {isAccent ? (
        <LinearGradient
          colors={["#FFD53D", "#FF7A59"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      ) : null}
      <View style={styles.buttonInner}>
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <>
            {StartIcon ? (
              <StartIcon size={20} color={fg} weight="fill" />
            ) : null}
            <Typography
              variant="title-sm"
              family="display"
              weight="bold"
              style={{ color: fg }}
            >
              {title}
            </Typography>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 30,
    lineHeight: 36,
  },
  subtitle: {
    color: "rgba(255,255,255,0.82)",
  },
  button: {
    height: 54,
    borderRadius: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
});
