import { AppCustomizationSection } from "@/components/AppCustomizationSection";
import { AppHeader } from "@/components/AppHeader";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SettingsRow } from "@/components/SettingsRow";
import { Typography } from "@/components/Typography";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { useTheme } from "@/hooks/useTheme";
import { useNotificationsStore } from "@/store/notifications";
import {
  type Appearance,
  type Language,
  useSettingsStore,
} from "@/store/settings";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ArrowSquareOut,
  BellRinging,
  CaretRight,
  Lifebuoy,
  ShieldCheck,
  UserCircle,
} from "phosphor-react-native";
import { type ComponentType, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Linking, Pressable, ScrollView, Switch, View } from "react-native";
import type { IconProps } from "phosphor-react-native";

const SUPPORT_URL = "https://meme-chat-ai.com/support";
const PRIVACY_URL = "https://meme-chat-ai.com/privacy";

// A tappable settings row that opens an external URL. Mirrors the plan card's
// treatment, with a leading icon and a trailing "external link" glyph.
function LinkRow({
  icon: Icon,
  label,
  onPress,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        borderRadius: 16,
        backgroundColor: pressed
          ? theme["--color-card-pressed"]
          : theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      })}
    >
      <Icon size={20} color={theme["--color-foreground"]} weight="regular" />
      <Typography
        variant="body"
        weight="semibold"
        style={{ flex: 1, color: theme["--color-foreground"] }}
      >
        {label}
      </Typography>
      <ArrowSquareOut
        size={18}
        weight="bold"
        color={theme["--color-foreground-muted"]}
      />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const appearance = useSettingsStore((s) => s.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const router = useRouter();
  const openPlan = useOpenPlan();

  // Notifications are gated by the OS permission, so the toggle reflects the
  // real system state rather than an app-local flag. We re-read it whenever the
  // screen regains focus — including when the user returns from the system
  // Settings app — so the switch always matches reality.
  const notificationPermission = useNotificationsStore((s) => s.permission);
  const refreshNotifications = useNotificationsStore((s) => s.refresh);
  const requestNotifications = useNotificationsStore((s) => s.requestPermission);
  const notificationsEnabled = notificationPermission === "granted";

  useFocusEffect(
    useCallback(() => {
      void refreshNotifications();
    }, [refreshNotifications]),
  );

  const openSystemSettings = () => {
    void Linking.openSettings().catch(() => {
      Alert.alert(t("common.error"), t("settings.about.openFailed"));
    });
  };

  const handleNotificationsToggle = (next: boolean) => {
    if (next) {
      // Turning on: request the OS permission. The native dialog only appears
      // the first time; once decided, the OS returns the prior answer silently,
      // so if it's not granted we send the user to Settings to flip it.
      void (async () => {
        const result = await requestNotifications();
        if (result !== "granted") {
          Alert.alert(
            t("settings.notifications.blockedTitle"),
            t("settings.notifications.blockedBody"),
            [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("settings.notifications.openSettings"),
                onPress: openSystemSettings,
              },
            ],
          );
        }
      })();
    } else {
      // The OS owns revocation — an app can't drop its own granted permission —
      // so turning off routes the user to the system Settings screen.
      Alert.alert(
        t("settings.notifications.disableTitle"),
        t("settings.notifications.disableBody"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("settings.notifications.openSettings"),
            onPress: openSystemSettings,
          },
        ],
      );
    }
  };

  const appearanceOptions: readonly { value: Appearance; label: string }[] = [
    { value: "system", label: t("settings.appearance.system") },
    { value: "light", label: t("settings.appearance.light") },
    { value: "dark", label: t("settings.appearance.dark") },
  ];

  const languageOptions: readonly { value: Language; label: string }[] = [
    { value: "system", label: t("settings.language.system") },
    { value: "en", label: t("settings.language.en") },
    { value: "es", label: t("settings.language.es") },
  ];

  const openUrl = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t("common.error"), t("settings.about.openFailed"));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <AppHeader title={t("settings.title")} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: 40,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={openPlan}
          accessibilityRole="button"
          accessibilityLabel={t("settings.plan.heading")}
          style={({ pressed }) => ({
            borderRadius: 16,
            backgroundColor: pressed
              ? theme["--color-card-pressed"]
              : theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-border"],
            padding: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          })}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Typography
              variant="title-sm"
              style={{ color: theme["--color-foreground"] }}
            >
              {t("settings.plan.heading")}
            </Typography>
            <Typography
              variant="caption"
              style={{ color: theme["--color-foreground-secondary"] }}
            >
              {t("settings.plan.rowDescription")}
            </Typography>
          </View>
          <CaretRight
            size={18}
            weight="bold"
            color={theme["--color-foreground-muted"]}
          />
        </Pressable>

        {/* Account hub — all credential/session/deletion controls live behind
            this row so the settings page stays short and to the point. */}
        <Pressable
          onPress={() => router.push("/account")}
          accessibilityRole="button"
          accessibilityLabel={t("settings.account.label")}
          style={({ pressed }) => ({
            borderRadius: 16,
            backgroundColor: pressed
              ? theme["--color-card-pressed"]
              : theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-border"],
            padding: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          })}
        >
          <UserCircle
            size={22}
            weight="bold"
            color={theme["--color-foreground"]}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Typography
              variant="title-sm"
              style={{ color: theme["--color-foreground"] }}
            >
              {t("settings.account.label")}
            </Typography>
            <Typography
              variant="caption"
              style={{ color: theme["--color-foreground-secondary"] }}
            >
              {t("settings.account.description")}
            </Typography>
          </View>
          <CaretRight
            size={18}
            weight="bold"
            color={theme["--color-foreground-muted"]}
          />
        </Pressable>

        {/* Notifications — wired to the real OS permission. */}
        <View
          style={{
            borderRadius: 16,
            backgroundColor: theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-border"],
            padding: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <BellRinging
            size={22}
            weight="bold"
            color={theme["--color-foreground"]}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Typography
              variant="title-sm"
              style={{ color: theme["--color-foreground"] }}
            >
              {t("settings.notifications.label")}
            </Typography>
            <Typography
              variant="caption"
              style={{ color: theme["--color-foreground-secondary"] }}
            >
              {t("settings.notifications.description")}
            </Typography>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleNotificationsToggle}
            accessibilityLabel={t("settings.notifications.label")}
            trackColor={{
              false: theme["--color-background-muted"],
              true: theme["--color-primary-subtle"],
            }}
            thumbColor={
              notificationsEnabled
                ? theme["--color-primary"]
                : theme["--color-foreground-muted"]
            }
          />
        </View>

        <SettingsRow label={t("settings.appearance.label")}>
          <SegmentedControl
            options={appearanceOptions}
            value={appearance}
            onChange={setAppearance}
          />
          <AppCustomizationSection />
        </SettingsRow>

        <SettingsRow label={t("settings.language.label")}>
          <SegmentedControl
            options={languageOptions}
            value={language}
            onChange={setLanguage}
          />
        </SettingsRow>

        <View style={{ gap: 10 }}>
          <LinkRow
            icon={Lifebuoy}
            label={t("settings.about.support")}
            onPress={() => void openUrl(SUPPORT_URL)}
          />
          <LinkRow
            icon={ShieldCheck}
            label={t("settings.about.privacy")}
            onPress={() => void openUrl(PRIVACY_URL)}
          />
        </View>

        <Typography
          variant="caption"
          style={{
            color: theme["--color-foreground-muted"],
            textAlign: "center",
            marginTop: 4,
          }}
        >
          {t("common.appName")}
        </Typography>
      </ScrollView>
    </View>
  );
}
