// MessageStickerAttachments
//
// Read-only renderer for sticker attachments carried on a (user) chat message.
// Stickers are transparent, so unlike memes/GIFs they render "contain" with NO
// card surface — they float in the bubble like reaction stamps. Up to
// MAX_MESSAGE_STICKERS render in a wrapping row. Each keeps the required KLIPY
// watermark (bottom-right), matching the meme/GIF attachment treatment.

import { AppPressable } from "@/components/AppPressable";
import type { MessageSticker } from "@/domain/stickers";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

const KLIPY_LOGO = require("../assets/images/klipy-logo-light.png");
const KLIPY_LOGO_RATIO = 376 / 103;

// Sticker render box. Smaller than meme/GIF attachments since a turn can carry
// up to three and they read as playful stamps, not full media.
const STICKER_SIZE = 104;

// The required KLIPY wordmark, bottom-right over a soft scrim so it stays legible
// against the sticker (or the bubble behind a transparent edge).
function Watermark() {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 26,
        justifyContent: "flex-end",
      }}
    >
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.35)"]}
        style={StyleSheet.absoluteFill}
      />
      <ExpoImage
        source={KLIPY_LOGO}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
        style={{
          alignSelf: "flex-end",
          height: 8,
          width: 8 * KLIPY_LOGO_RATIO,
          margin: 4,
          opacity: 0.95,
        }}
      />
    </View>
  );
}

export function MessageStickerAttachments({
  stickers,
  align,
  stickerLabel,
  onPressSticker,
}: {
  stickers: MessageSticker[];
  align: "start" | "end";
  stickerLabel: string;
  // Tapping a sticker opens it full-screen (chat thread only).
  onPressSticker?: (sticker: MessageSticker) => void;
}) {
  if (stickers.length === 0) return null;

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        justifyContent: align === "end" ? "flex-end" : "flex-start",
      }}
    >
      {stickers.map((sticker) => {
        const label = sticker.title
          ? `${stickerLabel}: ${sticker.title}`
          : stickerLabel;
        const media = (
          <>
            <ExpoImage
              source={{ uri: sticker.url }}
              placeholder={
                sticker.previewUrl ? { uri: sticker.previewUrl } : undefined
              }
              // "contain" so the transparent sticker reads cleanly without being
              // cropped to a square.
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={sticker.id}
              style={{ width: "100%", height: "100%" }}
            />
            <Watermark />
          </>
        );
        const box = {
          width: STICKER_SIZE,
          height: STICKER_SIZE,
          overflow: "hidden" as const,
        };
        return onPressSticker ? (
          <AppPressable
            key={sticker.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={label}
            onPress={() => onPressSticker(sticker)}
            feedback="opacity"
            style={box}
          >
            {media}
          </AppPressable>
        ) : (
          <View
            key={sticker.id}
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
