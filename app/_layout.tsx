import { MemeAvatar } from "@/components/MemeAvatar";
import { AccountSheet } from "@/components/AccountSheet";
import { ChatCustomizationSheet } from "@/components/ChatCustomizationSheet";
import { PlanSheet } from "@/components/PlanSheet";
import { LanguageSheet } from "@/components/LanguageSheet";
import { MemorySheet } from "@/components/MemorySheet";
import { NameSheet } from "@/components/NameSheet";
import { PersonaSheet } from "@/components/PersonaSheet";
import { RotLevelSheet } from "@/components/RotLevelSheet";
import { Typography } from "@/components/Typography";
import { UpdateRequiredScreen } from "@/components/UpdateRequiredScreen";
import { initializeMobileAds } from "@/domain/ads/mobileAds";
import { decideAuthRoute } from "@/domain/routing/authRoute";
import { themes } from "@/nativewind-theme";
import { useAgeGateStore } from "@/store/ageGate";
import { useAppUpdateStore } from "@/store/appUpdate";
import { useAuthStore } from "@/store/auth";
import { useNotificationsStore } from "@/store/notifications";
import { useOnboardingStore } from "@/store/onboarding";
import { usePersonaDraftStore } from "@/store/personaDraft";
import { usePersonaStore } from "@/store/personas";
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
  const ageGateHydrated = useAgeGateStore((s) => s.hydrated);
  const ageGatePassed = useAgeGateStore((s) => s.status === "passed");
  const initializeAuthSession = useAuthStore((s) => s.initializeAuthSession);
  const authUid = useAuthStore((s) => s.uid);
  const authStatus = useAuthStore((s) => s.status);
  const authEmailVerified = useAuthStore((s) => s.emailVerified);
  const authProviders = useAuthStore((s) => s.providers);
  const initializeSubscription = useSubscriptionStore((s) => s.initialize);
  const checkAppUpdate = useAppUpdateStore((s) => s.check);
  const updateRequired = useAppUpdateStore((s) => s.updateRequired);
  const updateStoreUrl = useAppUpdateStore((s) => s.storeUrl);

  const theme = themes[colorScheme ?? "light"];
  const router = useRouter();
  const segments = useSegments();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    Promise.all([
      hydrateSettings(),
      hydrateOnboarding(),
      hydrateAgeGate(),
      // Restore the locally-persisted persona selection so the chat header
      // shows the right bot before the (validating) list loads. Non-critical:
      // not part of the gate — it resolves to the default on a read error.
      usePersonaStore.getState().hydrateSelection(),
      // Local persona-creator drafts (device-only, not uid-keyed).
      usePersonaDraftStore.getState().hydrate(),
    ]).finally(() => setHydrated(true));
  }, [hydrateAgeGate, hydrateOnboarding, hydrateSettings]);

  // Force-update check runs independently of local hydration so the gate can
  // appear as soon as the remote floor is read. Fails open, so it never blocks
  // startup or locks a user out on a network blip.
  useEffect(() => {
    void checkAppUpdate();
  }, [checkAppUpdate]);

  useEffect(() => {
    if (hydrated) {
      void initializeAuthSession();
      void initializeSubscription();
      void initializeMobileAds();
      // Reads the current OS notification permission and, if granted, (re)arms
      // the daily 4pm rot-check — so it survives app restarts without the user
      // re-visiting Settings.
      void useNotificationsStore.getState().refresh();
    }
  }, [hydrated, initializeAuthSession, initializeSubscription]);

  // Hydrate the signed-in user's saved personas for the picker (and clear them
  // on sign-out so the next user on this device never sees the previous one's
  // bots). Keyed on uid + status so it re-runs across every auth transition.
  //
  // clear() must fire ONLY on a real sign-out ("signedOut"), never during the
  // pre-auth "idle"/"initializing" window — clear() wipes the persisted persona
  // pick, and doing that on every cold start (before auth resolves uid) raced
  // hydrateSelection() and randomly reset the user back to Brainrot Bot.
  useEffect(() => {
    if (authUid) {
      void usePersonaStore.getState().hydrate(authUid);
    } else if (authStatus === "signedOut") {
      usePersonaStore.getState().clear();
    }
  }, [authUid, authStatus]);

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
  const appReady = fontsLoaded && hydrated && ageGateHydrated && authResolved;
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
    if (appReady || updateRequired) {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [appReady, updateRequired]);

  useEffect(() => {
    if (!routeTarget) return;
    router.replace(routeTarget.href as never);
  }, [routeTarget, router]);

  // Force-update gate wins over everything (loading, auth, age gate, the app).
  // Once we've confirmed the install is below the floor there is no way past
  // this screen except updating.
  if (updateRequired) {
    return <UpdateRequiredScreen storeUrl={updateStoreUrl} />;
  }

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
            <LanguageSheet />
            <MemorySheet />
            <NameSheet />
            <PersonaSheet />
          </VariableContextProvider>
        </BottomSheetModalProvider>
      </PortalProvider>
    </GestureHandlerRootView>
  );
}
