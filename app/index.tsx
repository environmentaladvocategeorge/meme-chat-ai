import { Typography } from "@/components/Typography";
import { gradients } from "@/nativewind-theme";
import { useAuthStore } from "@/store/auth";
import * as AppleAuthentication from "expo-apple-authentication";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import {
  AppleLogo,
  CaretRight,
  Sparkle,
  type IconProps,
} from "phosphor-react-native";
import { ComponentType, ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MASCOT = require("../assets/images/meme-level-up.png");

// ---------------------------------------------------------------------------
// Landing screen
//
// The first thing a logged-out user sees. Goal: read instantly as "fun,
// unhinged meme AI" rather than a sterile auth gate. Built on the brand
// gradient (blue → purple → pink) at full saturation — no muted surfaces —
// with the bobbing mascot face, a live chat-preview, a bold display headline,
// and two CTAs. Everything fades/springs in on first mount so the page feels
// alive the moment it opens.
// ---------------------------------------------------------------------------

export default function LandingScreen() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme ?? "light";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const signInApple = useAuthStore((s) => s.signInApple);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [appleSubmitting, setAppleSubmitting] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  const handleApple = async () => {
    setAppleSubmitting(true);
    const result = await signInApple();
    setAppleSubmitting(false);
    if (!result.success && result.error !== "cancelled") {
      Alert.alert(t("common.error"), t("auth.errors.generic"));
    }
  };

  // Full-bleed brand sweep. We lean on the brand gradient stops directly so the
  // page is unapologetically saturated, then drop a dark veil from the middle
  // down so white copy + CTAs stay crisp over the busy hero.
  const brand = gradients[scheme].brand;
  const veil =
    scheme === "dark"
      ? (["rgba(11,7,20,0)", "rgba(11,7,20,0.55)", "rgba(11,7,20,0.92)"] as const)
      : (["rgba(8,5,24,0)", "rgba(8,5,24,0.45)", "rgba(10,6,28,0.82)"] as const);

  // Mascot + headline scale with the viewport so the whole page fits in one
  // screen without scrolling, even on short devices.
  const mascotSize = height < 700 ? 104 : height < 820 ? 120 : 132;
  const headlineSize = height < 700 ? 32 : 40;
  const hl = { fontSize: headlineSize, lineHeight: headlineSize + 4 };

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
        locations={[0, 0.55, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: 24,
        }}
      >
        {/* Hero mascot — absorbs the leftover vertical space so the whole
            page fits without scrolling. */}
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Animated.View
            entering={ZoomIn.delay(120).springify().damping(14).stiffness(220).mass(0.5)}
          >
            <MascotHero size={mascotSize} />
          </Animated.View>
        </View>

        {/* Chat preview */}
        <View style={{ marginTop: 10, gap: 10 }}>
          <ChatBubble
            side="left"
            avatar="🧢"
            text={t("landing.demoUser1")}
            colors={["#8B5CF6", "#7C3AED"]}
            delay={360}
          />
          <ChatBubble
            side="right"
            avatar="😎"
            text={t("landing.demoBot")}
            colors={["rgba(255,255,255,0.16)", "rgba(255,255,255,0.08)"]}
            glass
            delay={520}
          />
          <ChatBubble
            side="left"
            avatar="🥵"
            text={t("landing.demoUser2")}
            colors={["#FF4FB8", "#FF5DC8"]}
            delay={680}
          />
        </View>

        {/* Headline + tagline */}
        <View style={{ paddingTop: 16 }}>
          <Animated.View entering={FadeInUp.delay(780).springify().damping(14).stiffness(220).mass(0.5)}>
            <Typography
              family="display"
              weight="bold"
              style={[styles.headline, hl]}
            >
              {t("landing.headlineLine1")}
            </Typography>
            <View style={styles.headlineRow}>
              <Typography
                family="display"
                weight="bold"
                style={[styles.headline, hl]}
              >
                {t("landing.headlinePrefix")}
              </Typography>
              <View>
                <Typography
                  family="display"
                  weight="bold"
                  style={[styles.headline, hl, { color: "#FFD53D" }]}
                >
                  {t("landing.headlineHighlight")}
                </Typography>
                <LinearGradient
                  colors={["#FF4FB8", "#FF7A59"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.underline}
                />
              </View>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(880).springify().damping(14).stiffness(220).mass(0.5)}>
            <Typography
              variant="body-lg"
              style={styles.tagline}
            >
              {t("landing.tagline")}
            </Typography>
          </Animated.View>
        </View>

        {/* CTAs */}
        <View style={{ marginTop: 16, gap: 10 }}>
          <Animated.View entering={FadeInDown.delay(960).springify().damping(14).stiffness(220).mass(0.5)}>
            <CtaButton
              title={t("landing.signUp")}
              onPress={() => router.push("/auth/email")}
              variant="accent"
              startIcon={Sparkle}
              endIcon={CaretRight}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(1040).springify().damping(14).stiffness(220).mass(0.5)}>
            <CtaButton
              title={t("landing.signInLong")}
              onPress={() => router.push("/auth/sign-in")}
              variant="glass"
            />
          </Animated.View>

          {appleAvailable ? (
            <Animated.View
              entering={FadeInDown.delay(1120).springify().damping(14).stiffness(220).mass(0.5)}
            >
              <CtaButton
                title={t("landing.continueWithApple")}
                onPress={handleApple}
                variant="glass"
                startIcon={AppleLogo}
                loading={appleSubmitting}
              />
            </Animated.View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Mascot hero — the mascot face on its own, gently bobbing. No circular frame
// or glow (those clipped on shorter screens); the art already ships its own
// brand gradient so a rounded app-icon tile reads cleanly over the background.
// ---------------------------------------------------------------------------

function MascotHero({ size }: { size: number }) {
  return (
    <Floaty amplitude={7} duration={2600}>
      <View
        style={{
          borderRadius: size * 0.26,
          shadowColor: "#7C3AED",
          shadowOpacity: 0.55,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 12 },
          elevation: 14,
        }}
      >
        <Image
          source={MASCOT}
          style={{
            width: size,
            height: size,
            borderRadius: size * 0.26,
          }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
      </View>
    </Floaty>
  );
}

// ---------------------------------------------------------------------------
// Floaty — gentle, infinite vertical bob. Used for the mascot + accents so the
// hero never sits perfectly still.
// ---------------------------------------------------------------------------

function Floaty({
  children,
  amplitude = 8,
  duration = 2400,
  delay = 0,
  style,
}: {
  children: ReactNode;
  amplitude?: number;
  duration?: number;
  delay?: number;
  style?: object;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    // Smooth, infinite back-and-forth: 0 → 1 → 0 → … The `true` reverses each
    // repeat so the bob eases out and back rather than snapping to the start.
    t.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
  }, [t, duration, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -amplitude * t.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

// ---------------------------------------------------------------------------
// ChatBubble — one line of the looping "demo" conversation. Springs in with a
// horizontal slide based on which side it sits on.
// ---------------------------------------------------------------------------

function ChatBubble({
  side,
  avatar,
  text,
  colors,
  glass = false,
  delay,
}: {
  side: "left" | "right";
  avatar: string;
  text: string;
  colors: readonly [string, string, ...string[]];
  glass?: boolean;
  delay: number;
}) {
  const isLeft = side === "left";
  const entering = FadeInDown.delay(delay)
    .springify()
    .damping(14)
    .stiffness(220)
    .mass(0.5);

  const avatarEl = (
    <View style={styles.bubbleAvatar}>
      <Animated.Text style={{ fontSize: 18 }}>{avatar}</Animated.Text>
    </View>
  );

  return (
    <Animated.View
      entering={entering}
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 8,
        alignSelf: isLeft ? "flex-start" : "flex-end",
        justifyContent: isLeft ? "flex-start" : "flex-end",
        maxWidth: "86%",
      }}
    >
      {isLeft ? avatarEl : null}
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.bubble,
          {
            borderTopLeftRadius: isLeft ? 6 : 18,
            borderTopRightRadius: isLeft ? 18 : 6,
            borderWidth: glass ? 1 : 0,
            borderColor: "rgba(255,255,255,0.22)",
          },
        ]}
      >
        <Typography
          variant="body-sm"
          style={{ color: "#FFFFFF", lineHeight: 18 }}
        >
          {text}
        </Typography>
      </LinearGradient>
      {!isLeft ? avatarEl : null}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// CtaButton — bespoke landing CTAs. `accent` is the glowing yellow→orange
// primary; `glass` is the frosted secondary/Apple style. Built locally rather
// than reusing <Button/> because those derive from theme surfaces and would
// disappear against the saturated background.
// ---------------------------------------------------------------------------

function CtaButton({
  title,
  onPress,
  variant,
  startIcon: StartIcon,
  endIcon: EndIcon,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant: "accent" | "glass";
  startIcon?: ComponentType<IconProps>;
  endIcon?: ComponentType<IconProps>;
  loading?: boolean;
}) {
  const isAccent = variant === "accent";
  const fg = isAccent ? "#1A1206" : "#FFFFFF";

  const content = (
    <View style={styles.ctaInner}>
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
          {EndIcon ? <EndIcon size={20} color={fg} weight="bold" /> : null}
        </>
      )}
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.cta,
        isAccent
          ? {
              shadowColor: "#FF9A3A",
              shadowOpacity: 0.55,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              elevation: 10,
            }
          : {
              backgroundColor: "rgba(255,255,255,0.12)",
              borderWidth: 1.5,
              borderColor: "rgba(255,255,255,0.4)",
            },
        { opacity: pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
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
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    flexShrink: 1,
  },
  bubbleAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  headline: {
    color: "#FFFFFF",
    fontSize: 40,
    lineHeight: 44,
  },
  headlineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  underline: {
    height: 6,
    borderRadius: 3,
    marginTop: 2,
    width: "100%",
  },
  tagline: {
    color: "rgba(255,255,255,0.82)",
    marginTop: 14,
    maxWidth: "94%",
  },
  cta: {
    height: 54,
    borderRadius: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
});
