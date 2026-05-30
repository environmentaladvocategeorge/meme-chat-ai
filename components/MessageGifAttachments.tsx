// MessageGifAttachments
//
// Read-only renderer for GIF attachments carried on a chat message. Plays the
// animated asset via expo-image. Mirrors MessageImageAttachments (memes) but
// for the single GIF a turn may carry. Keeps the required KLIPY watermark.

import type { MessageGif } from "@/domain/gifs";
import { useTheme } from "@/hooks/useTheme";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Image, Pressable, StyleSheet, View } from "react-native";

const KLIPY_LOGO = require("../assets/images/klipy-logo-light.png");
const KLIPY_LOGO_RATIO = 376 / 103;

const MAX_W = 220;
const MAX_H = 220;
const MIN_W = 96;
const RADIUS = 16;

function displaySize(gif: MessageGif): { width: number; height: number } {
  if (!gif.width || !gif.height) return { width: 160, height: 160 };
  const ratio = gif.width / gif.height;
  let width = Math.min(MAX_W, gif.width);
  let height = width / ratio;
  if (height > MAX_H) {
    height = MAX_H;
    width = height * ratio;
  }
  width = Math.max(MIN_W, width);
  return { width, height };
}

function Watermark() {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 30,
        justifyContent: "flex-end",
      }}
    >
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.5)"]}
        style={StyleSheet.absoluteFill}
      />
      <Image
        source={KLIPY_LOGO}
        resizeMode="contain"
        style={{
          alignSelf: "flex-end",
          height: 9,
          width: 9 * KLIPY_LOGO_RATIO,
          margin: 5,
          opacity: 0.95,
        }}
      />
    </View>
  );
}

export function MessageGifAttachments({
  gifs,
  align,
  gifLabel,
  onPressGif,
}: {
  gifs: MessageGif[];
  align: "start" | "end";
  gifLabel: string;
  // Tapping a GIF opens it full-screen (chat thread only).
  onPressGif?: (gif: MessageGif) => void;
}) {
  const theme = useTheme();
  if (gifs.length === 0) return null;

  return (
    <View
      style={{ gap: 6, alignItems: align === "end" ? "flex-end" : "flex-start" }}
    >
      {gifs.map((gif) => {
        const { width, height } = displaySize(gif);
        return (
          <Pressable
            key={gif.id}
            accessibilityRole={onPressGif ? "imagebutton" : "image"}
            accessibilityLabel={
              gif.attribution ? `${gifLabel}. ${gif.attribution}` : gifLabel
            }
            onPress={onPressGif ? () => onPressGif(gif) : undefined}
            style={({ pressed }) => ({
              width,
              height,
              borderRadius: RADIUS,
              overflow: "hidden",
              backgroundColor: theme["--color-card-muted"],
              borderWidth: 1,
              borderColor: theme["--color-border"],
              opacity: pressed && onPressGif ? 0.9 : 1,
            })}
          >
            <ExpoImage
              source={{ uri: gif.url }}
              placeholder={gif.previewUrl ? { uri: gif.previewUrl } : undefined}
              contentFit="cover"
              style={{ width: "100%", height: "100%" }}
            />
            <Watermark />
          </Pressable>
        );
      })}
    </View>
  );
}
