import { Typography } from "@/components/Typography";
import { decideAuthRoute } from "@/domain/routing/authRoute";
import { themes } from "@/nativewind-theme";
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
    Promise.all([hydrateSettings(), hydrateOnboarding()]).finally(() =>
      setHydrated(true),
    );
  }, [hydrateOnboarding, hydrateSettings]);

  useEffect(() => {
    if (hydrated) {
      void initializeAuthSession();
      void initializeSubscription();
    }
  }, [hydrated, initializeAuthSession, initializeSubscription]);

  useLayoutEffect(() => {
    Appearance.setColorScheme(appearance === "system" ? null : appearance);
  }, [appearance]);

  const [fontsLoaded] = useFonts({
    // Body face: Poppins (static per-weight TTFs). Each weight is its own
    // font-family name because RN doesn't reliably engage the wght axis of
    // a single variable font via the `fontWeight` style — which is why
    // earlier NunitoSans-Variable always rendered at 400 regardless.
    "Poppins-Regular": require("../assets/fonts/Poppins-Regular.ttf"),
    "Poppins-Medium": require("../assets/fonts/Poppins-Medium.ttf"),
    "Poppins-SemiBold": require("../assets/fonts/Poppins-SemiBold.ttf"),
    "Poppins-Bold": require("../assets/fonts/Poppins-Bold.ttf"),
    // Display face: Fredoka (variable, weights do engage in our setup).
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
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme["--color-background"] },
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="auth/sign-in" />
              <Stack.Screen name="auth/email" />
              <Stack.Screen name="auth/verify-email" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="(app)" />
            </Stack>
          </VariableContextProvider>
        </BottomSheetModalProvider>
      </PortalProvider>
    </GestureHandlerRootView>
  );
}
