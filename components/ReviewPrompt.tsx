import { openAppStoreReview } from "@/domain/appStoreReview";
import { useReviewPromptStore } from "@/store/reviewPrompt";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

export function ReviewPrompt() {
  const { t } = useTranslation();
  const pending = useReviewPromptStore((s) => s.pending);
  const markAccepted = useReviewPromptStore((s) => s.markAccepted);
  const markDeclined = useReviewPromptStore((s) => s.markDeclined);
  const markLater = useReviewPromptStore((s) => s.markLater);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!pending || activeRef.current) return;
    activeRef.current = true;

    Alert.alert(
      t("reviewPrompt.title"),
      t("reviewPrompt.body"),
      [
        {
          text: t("reviewPrompt.later"),
          style: "cancel",
          onPress: () => {
            activeRef.current = false;
            void markLater();
          },
        },
        {
          text: t("reviewPrompt.noThanks"),
          style: "destructive",
          onPress: () => {
            activeRef.current = false;
            void markDeclined();
          },
        },
        {
          text: t("reviewPrompt.action"),
          onPress: () => {
            activeRef.current = false;
            void markAccepted().then(() => openAppStoreReview());
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          activeRef.current = false;
          void markLater();
        },
      },
    );
  }, [markAccepted, markDeclined, markLater, pending, t]);

  return null;
}
