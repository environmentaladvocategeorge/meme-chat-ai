// MessageGifAttachments
//
// Read-only renderer for GIF attachments carried on a chat message. Plays the
// animated asset via expo-image. Mirrors MessageImageAttachments (memes) but
// for the single GIF a turn may carry. Keeps the required KLIPY watermark.

import { AppPressable } from "@/components/AppPressable";
import type { MessageGif } from "@/domain/gifs";
import { fitAttachment } from "@/domain/mediaLayout";
import { useTheme } from "@/hooks/useTheme";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

const KLIPY_LOGO = require("../assets/images/klipy-logo-light.png");
const KLIPY_LOGO_RATIO = 376 / 103;

const RADIUS = 16;

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
      <ExpoImage
        source={KLIPY_LOGO}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
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
        const { width, height } = fitAttachment(gif);
        const box = {
          width,
          height,
          borderRadius: RADIUS,
          overflow: "hidden" as const,
          backgroundColor: theme["--color-card-muted"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        };
        const label = gif.attribution
          ? `${gifLabel}. ${gif.attribution}`
          : gifLabel;
        const media = (
          <>
            <ExpoImage
              source={{ uri: gif.url }}
              placeholder={gif.previewUrl ? { uri: gif.previewUrl } : undefined}
              contentFit="cover"
              // Keyed per asset so a recycled list cell never shows the
              // previous GIF's frames while the new one loads.
              recyclingKey={gif.id}
              style={{ width: "100%", height: "100%" }}
            />
            <Watermark />
          </>
        );
        // Interactive (chat thread) routes through the shared touch core; a
        // read-only render (no handler) stays a plain image View.
        return onPressGif ? (
          <AppPressable
            key={gif.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={label}
            onPress={() => onPressGif(gif)}
            feedback="opacity"
            style={box}
          >
            {media}
          </AppPressable>
        ) : (
          <View
            key={gif.id}
            accessible
            accessibilityRole="image"
            accessibilityLabel={label}
            style={box}
          >
            {media}
          </View>
        );
      })}
    </View>
  );
}
