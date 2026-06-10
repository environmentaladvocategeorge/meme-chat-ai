import { Button } from "@/components/Button";
import { MemeAvatar } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { themes } from "@/nativewind-theme";
import { ArrowSquareOut } from "phosphor-react-native";
import { useColorScheme } from "nativewind";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";

// Full-screen, non-dismissible force-update gate. Rendered in place of the whole
// app navigator when the installed build is below the required floor, so there
// is no way past it except updating. The only action is "Go to App Store".
export function UpdateRequiredScreen({ storeUrl }: { storeUrl: string }) {
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
      <MemeAvatar variant="loading" size={108} />
      <View style={{ alignItems: "center", gap: 8, width: "100%" }}>
        <Typography
          variant="title-xl"
          style={{ color: theme["--color-foreground"], textAlign: "center" }}
        >
          {t("appUpdate.title")}
        </Typography>
        <Typography
          variant="body"
          style={{
            color: theme["--color-foreground-secondary"],
            textAlign: "center",
          }}
        >
          {t("appUpdate.body")}
        </Typography>
      </View>
      <Button
        title={t("appUpdate.cta")}
        endIcon={ArrowSquareOut}
        onPress={() => {
          void Linking.openURL(storeUrl).catch(() => {});
        }}
        style={{ alignSelf: "stretch" }}
      />
    </View>
  );
}
