// AttachmentViewer
//
// A full-screen viewer for a chat-bubble attachment (a sent/received Klipy meme
// or GIF). Tapping an attachment in a message opens it here, where the user can
// download it. The downloaded file carries the KLIPY watermark, composited
// server-side (watermarkAttachment) — GIFs save as a static watermarked frame.
//
// Mount <AttachmentViewerProvider> once around the chat tree, then call
// useAttachmentViewer().open(...) from any attachment in the thread.

import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { watermarkAttachmentCallable } from "@/services/firebase/callables";
import { Image as ExpoImage } from "expo-image";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { DownloadSimple, X } from "phosphor-react-native";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ViewerPayload = {
  // The asset shown full-screen (animated for a GIF).
  displayUrl: string;
  // The still asset sent to the watermark service to download. For a meme this
  // is the display image; for a GIF it's the poster frame (static download).
  sourceUrl: string;
  kind: "meme" | "gif";
};

type ViewerContextValue = {
  open: (payload: ViewerPayload) => void;
};

const AttachmentViewerContext = createContext<ViewerContextValue | null>(null);

export function useAttachmentViewer(): ViewerContextValue {
  const ctx = useContext(AttachmentViewerContext);
  if (!ctx) {
    throw new Error("useAttachmentViewer must be used within AttachmentViewerProvider");
  }
  return ctx;
}

type DownloadState = "idle" | "saving" | "saved" | "error";

// Fetches the watermarked PNG, writes it to cache, and saves it to the device
// gallery. Throws "permission-denied" when the user declines library access.
async function downloadWatermarked(payload: ViewerPayload): Promise<void> {
  const { dataBase64 } = await watermarkAttachmentCallable(payload.sourceUrl);

  const fileUri = `${FileSystem.cacheDirectory}klipy-${payload.kind}-${Date.now()}.png`;
  await FileSystem.writeAsStringAsync(fileUri, dataBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Add-only permission is enough to save into the library.
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    throw new Error("permission-denied");
  }
  await MediaLibrary.saveToLibraryAsync(fileUri);
}

export function AttachmentViewerProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [payload, setPayload] = useState<ViewerPayload | null>(null);
  const [download, setDownload] = useState<DownloadState>("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const open = useCallback((next: ViewerPayload) => {
    setPayload(next);
    setDownload("idle");
    setErrorKey(null);
  }, []);

  const close = useCallback(() => {
    setPayload(null);
    setDownload("idle");
    setErrorKey(null);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!payload || download === "saving") return;
    setDownload("saving");
    setErrorKey(null);
    try {
      await downloadWatermarked(payload);
      setDownload("saved");
    } catch (err) {
      setDownload("error");
      setErrorKey(
        err instanceof Error && err.message === "permission-denied"
          ? "chat.attachments.download.permission"
          : "chat.attachments.download.failed",
      );
    }
  }, [payload, download]);

  const value = useMemo<ViewerContextValue>(() => ({ open }), [open]);

  const visible = payload !== null;
  // Fit the asset within the screen minus chrome, preserving aspect handled by
  // contentFit:"contain".
  const mediaW = width;
  const mediaH = height * 0.7;

  return (
    <AttachmentViewerContext.Provider value={value}>
      {children}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)" }}>
          {/* Tap the backdrop to dismiss. */}
          <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" />

          {payload ? (
            <View
              pointerEvents="box-none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 16,
              }}
            >
              <ExpoImage
                source={{ uri: payload.displayUrl }}
                contentFit="contain"
                style={{ width: mediaW - 32, height: mediaH }}
                accessibilityRole="image"
                accessibilityLabel={t(
                  payload.kind === "gif"
                    ? "chat.attachments.gifLabel"
                    : "chat.attachments.imageLabel",
                )}
              />
            </View>
          ) : null}

          {/* Close button, top-right. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            onPress={close}
            hitSlop={10}
            style={{
              position: "absolute",
              top: insets.top + 8,
              right: 16,
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.16)",
            }}
          >
            <X size={22} color="#FFFFFF" weight="bold" />
          </Pressable>

          {/* Download action, bottom. */}
          <View
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: insets.bottom + 16,
              gap: 8,
            }}
          >
            {errorKey ? (
              <Typography
                variant="body-sm"
                style={{ color: "#FFFFFF", textAlign: "center", opacity: 0.9 }}
              >
                {t(errorKey)}
              </Typography>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.attachments.download.button")}
              onPress={handleDownload}
              disabled={download === "saving"}
              style={({ pressed }) => ({
                height: 52,
                borderRadius: 26,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                backgroundColor: theme["--color-primary"],
                opacity: pressed || download === "saving" ? 0.85 : 1,
              })}
            >
              {download === "saving" ? (
                <ActivityIndicator color={theme["--color-primary-foreground"]} />
              ) : (
                <DownloadSimple
                  size={20}
                  color={theme["--color-primary-foreground"]}
                  weight="bold"
                />
              )}
              <Typography
                variant="title-sm"
                style={{ color: theme["--color-primary-foreground"], fontWeight: "800" }}
              >
                {download === "saving"
                  ? t("chat.attachments.download.saving")
                  : download === "saved"
                    ? t("chat.attachments.download.saved")
                    : t("chat.attachments.download.button")}
              </Typography>
            </Pressable>
          </View>
        </View>
      </Modal>
    </AttachmentViewerContext.Provider>
  );
}
