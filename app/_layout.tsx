import { MemeAvatar } from "@/components/MemeAvatar";
import { AccountSheet } from "@/components/AccountSheet";
import { ChatCustomizationSheet } from "@/components/ChatCustomizationSheet";
import { PlanSheet } from "@/components/PlanSheet";
import { RotLevelSheet } from "@/components/RotLevelSheet";
import { Typography } from "@/components/Typography";
import { initializeMobileAds } from "@/domain/ads/mobileAds";
import { decideAuthRoute } from "@/domain/routing/authRoute";
import { themes } from "@/nativewind-theme";
import { useAgeGateStore } from "@/store/ageGate";
import { useAuthStore } from "@/store/auth";
import { useOnboardingStore } from "@/store/onboarding";
import { useSettingsStore } from "@/store/settings";
import { useSubscriptionStore } from "@/store/subscription";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PortalProvider } from "@gorhom/portal";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme, VariableContextProvider } from "nativewind";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Appearance, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "../global.css";
import "../i18n";

void SplashScreen.preventAutoHideAsync().catch(() => {});

function LoadingScreen({
  backgroundColor,
  foregroundColor,
  mutedColor,
  primaryColor,
}: {
  backgroundColor: string;
  foregroundColor: string;
  mutedColor: string;
  primaryColor: string;
}) {
  const { t } = useTranslation();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        paddingHorizontal: 28,
        backgroundColor,
      }}
    >
      <MemeAvatar variant="loading" size={108} pulse />
      <View style={{ alignItems: "center", gap: 6, width: "100%" }}>
        <Typography
          variant="title-xl"
          style={{ color: foregroundColor, textAlign: "center" }}
        >
          {t("common.appName")}
        </Typography>
        <Typography
          variant="body"
          style={{ color: mutedColor, textAlign: "center" }}
        >
          {t("common.appLoading")}
        </Typography>
      </View>
      <ActivityIndicator color={primaryColor} />
    </View>
  );
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const appearance = useSettingsStore((s) => s.appearance);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const hydrateOnboarding = useOnboardingStore((s) => s.hydrate);
  const onboardingCompleted = useOnboardingStore((s) => s.completed);
  const hydrateAgeGate = useAgeGateStore((s) => s.hydrate);
  const ageGatePassed = useAgeGateStore((s) => s.status === "passed");
  const initializeAuthSession = useAuthStore((s) => s.initializeAuthSession);
  const authStatus = useAuthStore((s) => s.status);
  const authEmailVerified = useAuthStore((s) => s.emailVerified);
  const authProviders = useAuthStore((s) => s.providers);
  const initializeSubscription = useSubscriptionStore((s) => s.initialize);

  const theme = themes[colorScheme ?? "light"];
  const router = useRouter();
  const segments = useSegments();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    Promise.all([
      hydrateSettings(),
      hydrateOnboarding(),
      hydrateAgeGate(),
    ]).finally(() => setHydrated(true));
  }, [hydrateAgeGate, hydrateOnboarding, hydrateSettings]);

  useEffect(() => {
    if (hydrated) {
      void initializeAuthSession();
      void initializeSubscription();
      void initializeMobileAds();
    }
  }, [hydrated, initializeAuthSession, initializeSubscription]);

  useLayoutEffect(() => {
    Appearance.setColorScheme(appearance === "system" ? null : appearance);
  }, [appearance]);

  const [fontsLoaded] = useFonts({
    "Poppins-Regular": require("../assets/fonts/Poppins-Regular.ttf"),
    "Poppins-Medium": require("../assets/fonts/Poppins-Medium.ttf"),
    "Poppins-SemiBold": require("../assets/fonts/Poppins-SemiBold.ttf"),
    "Poppins-Bold": require("../assets/fonts/Poppins-Bold.ttf"),
    Fredoka: require("../assets/fonts/Fredoka-Variable.ttf"),
  });

  const authResolved =
    authStatus !== "idle" &&
    authStatus !== "initializing" &&
    authStatus !== "deleting";

  const isAuthenticated = authStatus === "authenticated";
  const appReady = fontsLoaded && hydrated && authResolved;
  const segs = segments as readonly string[];
  const inOnboarding = segs[0] === "onboarding";
  const atAgeGate = segs[0] === "age-gate";
  const atLanding = segs[0] === undefined;
  const inAuth = segs[0] === "auth";
  const authRoute: string | undefined =
    typeof segs[1] === "string" ? segs[1] : undefined;
  const atVerifyEmail = inAuth && authRoute === "verify-email";

  const needsEmailVerification =
    isAuthenticated &&
    !authEmailVerified &&
    authProviders.some((p) => p.providerId === "password");

  const routeTarget = useMemo(
    () =>
      decideAuthRoute({
        appReady,
        ageGatePassed,
        atAgeGate,
        isAuthenticated,
        onboardingCompleted,
        needsEmailVerification,
        atLanding,
        inAuth,
        inOnboarding,
        atVerifyEmail,
      }),
    [
      appReady,
      ageGatePassed,
      atAgeGate,
      atLanding,
      atVerifyEmail,
      inAuth,
      inOnboarding,
      isAuthenticated,
      needsEmailVerification,
      onboardingCompleted,
    ],
  );

  useEffect(() => {
    if (appReady) {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [appReady]);

  useEffect(() => {
    if (!routeTarget) return;
    router.replace(routeTarget.href as never);
  }, [routeTarget, router]);

  if (!appReady) {
    return (
      <LoadingScreen
        backgroundColor={theme["--color-background"]}
        foregroundColor={theme["--color-foreground"]}
        mutedColor={theme["--color-foreground-secondary"]}
        primaryColor={theme["--color-primary"]}
      />
    );
  }

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: theme["--color-background"] }}
    >
      <PortalProvider>
        <BottomSheetModalProvider>
          <VariableContextProvider value={theme}>
            <View style={{ flex: 1 }}>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: {
                    backgroundColor: theme["--color-background"],
                  },
                }}
              >
                <Stack.Screen name="age-gate" />
                <Stack.Screen name="index" />
                <Stack.Screen name="auth/sign-in" />
                <Stack.Screen name="auth/email" />
                <Stack.Screen name="auth/verify-email" />
                <Stack.Screen name="onboarding" />
                <Stack.Screen name="(app)" />
              </Stack>
            </View>

            <PlanSheet />
            <ChatCustomizationSheet />
            <AccountSheet />
            <RotLevelSheet />
          </VariableContextProvider>
        </BottomSheetModalProvider>
      </PortalProvider>
    </GestureHandlerRootView>
  );
}
