import { MemeAvatar } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { themes } from "@/nativewind-theme";
import { useColorScheme } from "nativewind";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, View } from "react-native";

// Full-screen, non-dismissible takeover shown while an account deletion is in
// flight (auth status === "deleting"). Rendered in place of the whole app
// navigator — over the account sheet that started it — so the wipe can't be
// cancelled, navigated away from, or re-triggered mid-flight. There is
// deliberately NO action button: the only exits are success (auth flips to
// signed-out → routes to the landing screen) or a callable failure (auth flips
// back to authenticated → the account sheet surfaces the error).
export function DeletingAccountScreen() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = themes[colorScheme ?? "light"];

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        paddingHorizontal: 28,
        backgroundColor: theme["--color-background"],
      }}
    >
      <MemeAvatar variant="loading" size={108} pulse />
      <View style={{ alignItems: "center", gap: 8, width: "100%" }}>
        <Typography
          variant="title-xl"
          style={{ color: theme["--color-foreground"], textAlign: "center" }}
        >
          {t("account.deleteAccount.deletingTitle")}
        </Typography>
        <Typography
          variant="body"
          style={{
            color: theme["--color-foreground-secondary"],
            textAlign: "center",
          }}
        >
          {t("account.deleteAccount.deletingBody")}
        </Typography>
      </View>
      <ActivityIndicator color={theme["--color-primary"]} />
    </View>
  );
}
