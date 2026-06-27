// PublishingOverlay (create flow)
//
// A full-screen, can't-be-quit "bringing it to life" view while savePersona runs
// (moderation + render + avatar upload take a beat), then a success view whose
// only way out is "Start Chatting Now". Name + avatar are passed in (snapshotted
// at publish time) so it stays correct after the working draft is discarded.

import { AppPressable } from "@/components/AppPressable";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { Image } from "expo-image";
import { CheckCircle } from "phosphor-react-native";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const OVERLAY_AVATAR = 116;

export function PublishingOverlay({
  phase,
  name,
  avatarUri,
  onStart,
}: {
  phase: "publishing" | "done";
  name: string;
  avatarUri: string | null;
  onStart: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const done = phase === "done";

  // A single arc rotating around the avatar — a defined stroke, not a pulsing
  // color fill. Spins while it "comes to life"; gone on success.
  const spin = useSharedValue(0);
  useEffect(() => {
    if (done) return;
    spin.value = 0;
    spin.value = withRepeat(
      withTiming(1, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [done, spin]);
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  const monogram = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: theme["--color-background"],
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 32,
          gap: 22,
        },
      ]}
    >
      <View
        style={{
          width: OVERLAY_AVATAR + 28,
          height: OVERLAY_AVATAR + 28,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!done ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                width: OVERLAY_AVATAR + 22,
                height: OVERLAY_AVATAR + 22,
                borderRadius: (OVERLAY_AVATAR + 22) / 2,
                borderWidth: 3,
                borderColor: "transparent",
                borderTopColor: theme["--color-primary"],
                borderRightColor: theme["--color-primary"],
              },
              spinStyle,
            ]}
          />
        ) : null}
        {avatarUri ? (
          <Image
            source={{ uri: avatarUri }}
            style={{
              width: OVERLAY_AVATAR,
              height: OVERLAY_AVATAR,
              borderRadius: OVERLAY_AVATAR / 2,
              borderWidth: 3,
              borderColor: theme["--color-primary-muted"],
              backgroundColor: theme["--color-card-muted"],
            }}
            contentFit="cover"
          />
        ) : (
          <View
            style={{
              width: OVERLAY_AVATAR,
              height: OVERLAY_AVATAR,
              borderRadius: OVERLAY_AVATAR / 2,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 3,
              borderColor: theme["--color-primary-muted"],
              backgroundColor: theme["--color-card-muted"],
            }}
          >
            <Typography
              variant="title-xl"
              style={{ color: theme["--color-foreground"] }}
            >
              {monogram}
            </Typography>
          </View>
        )}
        {done ? (
          <View style={{ position: "absolute", right: 2, bottom: 2 }}>
            <CheckCircle
              size={40}
              weight="fill"
              color={theme["--color-success"]}
            />
          </View>
        ) : null}
      </View>

      <View style={{ alignItems: "center", gap: 8 }}>
        <Typography
          variant="title-xl"
          style={{ color: theme["--color-foreground"], textAlign: "center" }}
        >
          {done
            ? t("personasCreator.publishDone.ready", { name })
            : t("personasCreator.publishDone.bringing", { name })}
        </Typography>
        {!done ? (
          <Typography
            variant="body"
            style={{
              color: theme["--color-foreground-muted"],
              textAlign: "center",
              maxWidth: 320,
            }}
          >
            {t("personasCreator.publishDone.bringingHint")}
          </Typography>
        ) : null}
      </View>

      {done ? (
        <AppPressable
          onPress={onStart}
          accessibilityLabel={t("personasCreator.publishDone.startChatting")}
          pressScale={0.04}
          style={{
            marginTop: 6,
            paddingVertical: 15,
            paddingHorizontal: 28,
            borderRadius: 16,
            backgroundColor: theme["--color-primary"],
            alignItems: "center",
            justifyContent: "center",
            minWidth: 230,
          }}
        >
          <Typography
            variant="body"
            weight="semibold"
            style={{ color: theme["--color-primary-foreground"] }}
          >
            {t("personasCreator.publishDone.startChatting")}
          </Typography>
        </AppPressable>
      ) : null}
    </View>
  );
}
