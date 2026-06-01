import { AppPressable } from "@/components/AppPressable";
import { Typography } from "@/components/Typography";
import { MAX_MESSAGE_IMAGES, type MessageImage } from "@/domain/memes";
import { type MessageGif } from "@/domain/gifs";
import { useTheme } from "@/hooks/useTheme";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { X } from "phosphor-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

// Staged attachment tray: the row of meme thumbnails above the composer that a
// user has picked but not yet sent. Each thumbnail keeps the KLIPY watermark
// (attribution) and a remove button. Shows a brief localized notice when the
// user tries to exceed MAX_MESSAGE_IMAGES.
export function StagedAttachmentTray({
  images,
  gif,
  showMaxNotice,
  onRemove,
  onRemoveGif,
}: {
  images: MessageImage[];
  gif: MessageGif | null;
  showMaxNotice: boolean;
  onRemove: (id: string) => void;
  onRemoveGif: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const hasAny = images.length > 0 || gif !== null;
  if (!hasAny && !showMaxNotice) return null;

  // Position lives on the static hit target (containerStyle); the circle that
  // scales on press lives on the inner surface (style).
  const removeContainerStyle = {
    position: "absolute" as const,
    top: -6,
    right: -6,
    width: 22,
    height: 22,
  };
  const removeSurfaceStyle = {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: theme["--color-foreground"],
  };

  return (
    <View style={{ paddingBottom: 8 }}>
      {hasAny ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {/* Staged GIF (max one) renders first, animated. */}
          {gif ? (
            <View key={gif.id} style={{ width: 64, height: 64 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 12,
                  overflow: "hidden",
                  backgroundColor: theme["--color-card-muted"],
                  borderWidth: 1,
                  borderColor: theme["--color-border"],
                }}
              >
                <ExpoImage
                  source={{ uri: gif.url }}
                  placeholder={
                    gif.previewUrl ? { uri: gif.previewUrl } : undefined
                  }
                  contentFit="cover"
                  style={{ width: "100%", height: "100%" }}
                />
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 16,
                  }}
                >
                  <LinearGradient
                    colors={["transparent", "rgba(0,0,0,0.45)"]}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
              </View>
              <AppPressable
                accessibilityLabel={t("chat.attachments.remove")}
                onPress={onRemoveGif}
                haptic
                hitSlop={8}
                pressScale={0.12}
                containerStyle={removeContainerStyle}
                style={removeSurfaceStyle}
              >
                <X size={12} color={theme["--color-background"]} weight="bold" />
              </AppPressable>
            </View>
          ) : null}
          {images.map((image) => (
            <View key={image.id} style={{ width: 64, height: 64 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 12,
                  overflow: "hidden",
                  backgroundColor: theme["--color-card-muted"],
                  borderWidth: 1,
                  borderColor: theme["--color-border"],
                }}
              >
                <ExpoImage
                  source={{ uri: image.url }}
                  contentFit="cover"
                  cachePolicy={image.source === "upload" ? "memory" : "memory-disk"}
                  transition={150}
                  recyclingKey={image.id}
                  style={{ width: "100%", height: "100%" }}
                />
                {image.source === "klipy" ? (
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: 16,
                    }}
                  >
                    <LinearGradient
                      colors={["transparent", "rgba(0,0,0,0.45)"]}
                      style={StyleSheet.absoluteFill}
                    />
                  </View>
                ) : null}
              </View>
              <AppPressable
                accessibilityLabel={t("chat.attachments.remove")}
                onPress={() => onRemove(image.id)}
                haptic
                hitSlop={8}
                pressScale={0.12}
                containerStyle={removeContainerStyle}
                style={removeSurfaceStyle}
              >
                <X
                  size={12}
                  color={theme["--color-background"]}
                  weight="bold"
                />
              </AppPressable>
            </View>
          ))}
        </View>
      ) : null}
      {showMaxNotice ? (
        <Typography
          variant="caption"
          style={{
            color: theme["--color-foreground-muted"],
            marginTop: images.length > 0 ? 6 : 0,
          }}
        >
          {t("chat.attachments.maxReached", { count: MAX_MESSAGE_IMAGES })}
        </Typography>
      ) : null}
    </View>
  );
}
