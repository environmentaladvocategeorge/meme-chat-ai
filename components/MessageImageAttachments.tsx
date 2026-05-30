// MessageImageAttachments
//
// Read-only renderer for image attachments carried on a chat message (Klipy
// memes). Used inside message bubbles. Each image keeps the required KLIPY
// watermark so attribution is preserved wherever a meme is shown.

import { fitAttachment } from "@/domain/mediaLayout";
import type { MessageImage } from "@/domain/memes";
import { useTheme } from "@/hooks/useTheme";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, View } from "react-native";

// 376×103 source wordmark — same asset the meme strip uses.
const KLIPY_LOGO = require("../assets/images/klipy-logo-light.png");
const KLIPY_LOGO_RATIO = 376 / 103;

const RADIUS = 16;

// The KLIPY watermark scrim, bottom-right, matching the meme strip treatment.
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

export function MessageImageAttachments({
  images,
  align,
  imageLabel,
  onPressImage,
}: {
  images: MessageImage[];
  align: "start" | "end";
  imageLabel: string;
  // Tapping an attachment opens it full-screen (chat thread only).
  onPressImage?: (image: MessageImage) => void;
}) {
  const theme = useTheme();
  if (images.length === 0) return null;

  return (
    <View
      style={{ gap: 6, alignItems: align === "end" ? "flex-end" : "flex-start" }}
    >
      {images.map((image) => {
        const { width, height } = fitAttachment(image);
        return (
          <Pressable
            key={image.id}
            accessibilityRole={onPressImage ? "imagebutton" : "image"}
            accessibilityLabel={image.attribution ? `${imageLabel}. ${image.attribution}` : imageLabel}
            onPress={onPressImage ? () => onPressImage(image) : undefined}
            style={({ pressed }) => ({
              width,
              height,
              borderRadius: RADIUS,
              overflow: "hidden",
              backgroundColor: theme["--color-card-muted"],
              borderWidth: 1,
              borderColor: theme["--color-border"],
              opacity: pressed && onPressImage ? 0.9 : 1,
            })}
          >
            <Image
              source={{ uri: image.url }}
              contentFit="cover"
              // Memory+disk cache so a meme shown once renders instantly when
              // the thread scrolls back to it. Brief fade as the CDN streams in.
              cachePolicy="memory-disk"
              transition={150}
              recyclingKey={image.id}
              style={{ width: "100%", height: "100%" }}
            />
            {image.source === "klipy" ? <Watermark /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
