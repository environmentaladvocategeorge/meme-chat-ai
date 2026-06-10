import Constants from "expo-constants";
import { AdBanner } from "@/components/ads/AdBanner";
import { AppCustomizationSection } from "@/components/AppCustomizationSection";
import { AppHeader } from "@/components/AppHeader";
import { AppPressable } from "@/components/AppPressable";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SettingsRow } from "@/components/SettingsRow";
import { Typography } from "@/components/Typography";
import { openAppStoreReview } from "@/domain/appStoreReview";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { useTheme } from "@/hooks/useTheme";
import { PLAN_RANK } from "@/domain/billing";
import { useMemoryMeta } from "@/hooks/useMemory";
import { useChatStore } from "@/store/chat";
import { useRotLevelSheetStore } from "@/store/rotLevelSheet";
import { useAccountSheetStore } from "@/store/accountSheet";
import { useDisplayPlan } from "@/store/entitlement";
import { useLanguageSheetStore } from "@/store/languageSheet";
import { useMemorySheetStore } from "@/store/memorySheet";
import { useNotificationsStore } from "@/store/notifications";
import {
  type Appearance,
  useSettingsStore,
} from "@/store/settings";
import { useFocusEffect } from "expo-router";
import {
  ArrowSquareOut,
  BellRinging,
  Brain,
  CaretRight,
  FileText,
  Flame,
  Lifebuoy,
  ShieldCheck,
  Star,
  UserCircle,
} from "phosphor-react-native";
import { type ComponentType, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Linking, ScrollView, Switch, View } from "react-native";
import type { IconProps } from "phosphor-react-native";

const SUPPORT_URL = "https://meme-chat-ai.com/support";
const PRIVACY_URL = "https://meme-chat-ai.com/privacy";
// Apple's Standard EULA — used because the app doesn't ship a custom EULA.
const TERMS_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

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
    <AppPressable
      onPress={onPress}
      accessibilityRole="link"
      feedback="opacity"
      accessibilityLabel={label}
      style={{
        borderRadius: 16,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
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
    </AppPressable>
  );
}

// Small uppercase header that groups a set of settings rows into a section.
function SectionLabel({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <Typography
      variant="overline"
      style={{ color: theme["--color-foreground-muted"], marginLeft: 4 }}
    >
      {label}
    </Typography>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const appearance = useSettingsStore((s) => s.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  const language = useSettingsStore((s) => s.language);
  const openAccount = useAccountSheetStore((s) => s.open);
  const openLanguageSheet = useLanguageSheetStore((s) => s.open);
  const openMemory = useMemorySheetStore((s) => s.open);
  const openPlan = useOpenPlan();

  // Rot Level lives on the chat store; the row just opens the same global
  // RotLevelSheet (mounted in the root layout) and shows the current tier.
  const rotLevel = useChatStore((s) => s.rotLevel);
  const openRotSheet = useRotLevelSheetStore((s) => s.open);
  const rotLevelName = t(
    `chat.rot.levels.level${Math.min(Math.max(rotLevel, 1), 3)}.name` as const,
  );

  const plan = useDisplayPlan();
  const memoryPaid = PLAN_RANK[plan] > PLAN_RANK.free;
  const memoryAccess = memoryPaid;
  const { meta: memoryMeta } = useMemoryMeta();
  // Only ever show On/Off, and only when the user actually has access. We never
  // label the row "Paid" — that reads as a wall and deters the tap; the upsell
  // lives inside the sheet instead.
  const memoryStatus = memoryMeta.enabled
    ? t("settings.memory.rowOn")
    : t("settings.memory.rowOff");

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

  const openUrl = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t("common.error"), t("settings.about.openFailed"));
    }
  };

  // Shared single-line row box. Subtext removed across the board so the whole
  // page fits with far less scrolling — each row is just an icon + label.
  const rowStyle = {
    borderRadius: 16,
    backgroundColor: theme["--color-card"],
    borderWidth: 1,
    borderColor: theme["--color-border"],
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  } as const;

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
        {/* 1. Plan & usage */}
        <AppPressable
          onPress={openPlan}
          feedback="opacity"
          accessibilityLabel={t("settings.plan.heading")}
          style={rowStyle}
        >
          <Typography
            variant="title-sm"
            style={{ flex: 1, color: theme["--color-foreground"] }}
          >
            {t("settings.plan.heading")}
          </Typography>
          <Typography
            variant="caption"
            weight="semibold"
            style={{ color: theme["--color-foreground-muted"] }}
          >
            {t(`settings.plan.planNames.${plan}` as const)}
          </Typography>
          <CaretRight
            size={18}
            weight="bold"
            color={theme["--color-foreground-muted"]}
          />
        </AppPressable>

        {/* Preferences */}
        <View style={{ gap: 10 }}>
          <SectionLabel label={t("settings.sections.preferences")} />

          {/* Rot Level — opens the same global sheet as the chat composer. */}
          <AppPressable
            onPress={() => openRotSheet()}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={t("chat.rot.button")}
            style={rowStyle}
          >
            <Flame size={22} weight="bold" color={theme["--color-foreground"]} />
            <Typography
              variant="title-sm"
              style={{ flex: 1, color: theme["--color-foreground"] }}
            >
              {t("chat.rot.button")}
            </Typography>
            <Typography
              variant="caption"
              weight="semibold"
              style={{ color: theme["--color-foreground-muted"] }}
            >
              {rotLevelName}
            </Typography>
            <CaretRight
              size={18}
              weight="bold"
              color={theme["--color-foreground-muted"]}
            />
          </AppPressable>

          {/* Memory */}
          <AppPressable
            onPress={() => openMemory()}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={t("settings.memory.rowLabel")}
            style={rowStyle}
          >
              <Brain size={22} weight="bold" color={theme["--color-foreground"]} />
              <Typography
                variant="title-sm"
                style={{ flex: 1, color: theme["--color-foreground"] }}
              >
                {t("settings.memory.rowLabel")}
              </Typography>
              {memoryAccess ? (
                <Typography
                  variant="caption"
                  weight="semibold"
                  style={{ color: theme["--color-foreground-muted"] }}
                >
                  {memoryStatus}
                </Typography>
              ) : null}
              <CaretRight
                size={18}
                weight="bold"
                color={theme["--color-foreground-muted"]}
              />
          </AppPressable>

          <SettingsRow label={t("settings.appearance.label")}>
            <SegmentedControl
              options={appearanceOptions}
              value={appearance}
              onChange={setAppearance}
            />
            <AppCustomizationSection />
          </SettingsRow>

          {/* Notifications — wired to the real OS permission. */}
          <View style={rowStyle}>
            <BellRinging
              size={22}
              weight="bold"
              color={theme["--color-foreground"]}
            />
            <Typography
              variant="title-sm"
              style={{ flex: 1, color: theme["--color-foreground"] }}
            >
              {t("settings.notifications.label")}
            </Typography>
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

          <SettingsRow label={t("settings.language.label")}>
            <AppPressable
              onPress={openLanguageSheet}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel={t("settings.language.label")}
              style={{
                borderTopWidth: 1,
                borderTopColor: theme["--color-border"],
                paddingTop: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Typography
                variant="body"
                style={{ flex: 1, color: theme["--color-foreground"] }}
              >
                {t(`settings.language.${language}` as const)}
              </Typography>
              <CaretRight
                size={18}
                weight="bold"
                color={theme["--color-foreground-muted"]}
              />
            </AppPressable>
          </SettingsRow>
        </View>

        {/* Account */}
        <View style={{ gap: 10 }}>
          <SectionLabel label={t("settings.sections.account")} />
          <AppPressable
            onPress={() => openAccount()}
            feedback="opacity"
            accessibilityLabel={t("settings.account.label")}
            style={rowStyle}
          >
            <UserCircle
              size={22}
              weight="bold"
              color={theme["--color-foreground"]}
            />
            <Typography
              variant="title-sm"
              style={{ flex: 1, color: theme["--color-foreground"] }}
            >
              {t("settings.account.label")}
            </Typography>
            <CaretRight
              size={18}
              weight="bold"
              color={theme["--color-foreground-muted"]}
            />
          </AppPressable>
        </View>

        {/* About */}
        <View style={{ gap: 10 }}>
          <SectionLabel label={t("settings.sections.about")} />
          <LinkRow
            icon={Star}
            label={t("settings.about.review")}
            onPress={() => void openAppStoreReview()}
          />
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
          <LinkRow
            icon={FileText}
            label={t("settings.about.terms")}
            onPress={() => void openUrl(TERMS_URL)}
          />
        </View>

        {/* Free-tier ad banner — hidden for Pro (any paid plan). */}
        <AdBanner />

        <Typography
          variant="caption"
          style={{
            color: theme["--color-foreground-muted"],
            textAlign: "center",
            marginTop: 4,
          }}
        >
          {`v${Constants.expoConfig?.version ?? ""}`}
        </Typography>
      </ScrollView>
    </View>
  );
}
