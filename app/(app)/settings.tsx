import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SettingsRow } from "@/components/SettingsRow";
import { Typography } from "@/components/Typography";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/auth";
import {
  type Appearance,
  type Language,
  useSettingsStore,
} from "@/store/settings";
import { useRouter } from "expo-router";
import {
  ArrowSquareOut,
  CaretRight,
  Lifebuoy,
  ShieldCheck,
} from "phosphor-react-native";
import type { ComponentType } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";
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
  const signOut = useAuthStore((s) => s.signOut);
  const providers = useAuthStore((s) => s.providers);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const deleteAccountWithApple = useAuthStore((s) => s.deleteAccountWithApple);

  const hasPasswordProvider = providers.some((p) => p.providerId === "password");

  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const performDeletion = async () => {
    setDeleting(true);
    const result = hasPasswordProvider
      ? await deleteAccount(password)
      : await deleteAccountWithApple();
    setDeleting(false);
    if (!result.success) {
      Alert.alert(t("common.error"), t("settings.deleteData.failed"));
      return;
    }
    setConfirming(false);
    setPassword("");
  };

  const handleDelete = () => {
    if (confirming) {
      void performDeletion();
      return;
    }
    Alert.alert(
      t("settings.deleteData.confirmTitle"),
      t("settings.deleteData.confirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.deleteData.confirm"),
          style: "destructive",
          onPress: () => {
            if (hasPasswordProvider) {
              setConfirming(true);
            } else {
              void performDeletion();
            }
          },
        },
      ],
    );
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

        <SettingsRow label={t("settings.appearance.label")}>
          <SegmentedControl
            options={appearanceOptions}
            value={appearance}
            onChange={setAppearance}
          />
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

        <SettingsRow
          label={t("settings.deleteData.label")}
          description={t("settings.deleteData.description")}
        >
          {confirming && hasPasswordProvider ? (
            <View style={{ gap: 12 }}>
              <Input
                label={t("settings.deleteData.passwordPrompt")}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={t("common.cancel")}
                    variant="ghost"
                    onPress={() => {
                      setConfirming(false);
                      setPassword("");
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title={t("settings.deleteData.confirm")}
                    loading={deleting}
                    disabled={password.length === 0}
                    style={{ backgroundColor: theme["--color-error"] }}
                    onPress={() => void performDeletion()}
                  />
                </View>
              </View>
            </View>
          ) : (
            <Button
              title={t("settings.deleteData.button")}
              loading={deleting}
              style={{ backgroundColor: theme["--color-error"] }}
              onPress={handleDelete}
            />
          )}
        </SettingsRow>

        <View style={{ marginTop: 8 }}>
          <Button
            title={t("settings.signOut")}
            variant="outline"
            onPress={() => void signOut()}
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
