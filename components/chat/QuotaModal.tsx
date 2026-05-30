import { MemeAvatar } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { formatResetMoment } from "@/domain/usage";
import { useTheme } from "@/hooks/useTheme";
import { type QuotaInfo } from "@/store/chat";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, View } from "react-native";
import { UpgradeButton } from "./UpgradeButton";

export function QuotaModal({
  quota,
  isTopTier,
  onUpgrade,
  onDismiss,
}: {
  quota: QuotaInfo | null;
  isTopTier: boolean;
  onUpgrade: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const visible = quota !== null;

  const dateLabel = useMemo(() => {
    if (!quota?.resetAt) return t("common.reset.soon");
    const parsed = new Date(quota.resetAt);
    if (Number.isNaN(parsed.getTime())) return t("common.reset.soon");
    return formatResetMoment(parsed, Date.now(), t);
  }, [quota?.resetAt, t]);

  // `reason` mirrors the server's QuotaReason discriminator (see
  // functions/src/billing/ledger.ts). Each branch picks a tailored copy
  // string; unknown reasons fall back to the monthly message.
  const body = useMemo(() => {
    switch (quota?.reason) {
      case "daily":
        return t("chat.quota.daily", { date: dateLabel });
      default:
        return t("chat.quota.monthly", { date: dateLabel });
    }
  }, [quota?.reason, dateLabel, t]);

  const handleUpgrade = () => {
    onDismiss();

    setTimeout(() => {
      onUpgrade();
    }, 300);
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
      >
        <View
          style={{
            backgroundColor: theme["--color-card"],
            borderRadius: 24,
            paddingHorizontal: 22,
            paddingTop: 24,
            paddingBottom: 18,
            gap: 14,
            alignItems: "center",
          }}
        >
          <MemeAvatar variant="worried" size={92} pulse />
          <Typography
            variant="title-md"
            style={{
              color: theme["--color-foreground"],
              fontWeight: "800",
              textAlign: "center",
            }}
          >
            {t("chat.quota.title")}
          </Typography>
          <Typography
            variant="body"
            style={{
              color: theme["--color-foreground-secondary"],
              textAlign: "center",
            }}
          >
            {body}
          </Typography>

          <View style={{ width: "100%", gap: 8, marginTop: 2 }}>
            <UpgradeButton isTopTier={isTopTier} onPress={handleUpgrade} />
            <Pressable
              accessibilityRole="button"
              onPress={onDismiss}
              style={{
                alignItems: "center",
                paddingVertical: 10,
                borderRadius: 10,
              }}
            >
              <Typography
                variant="body"
                style={{
                  color: theme["--color-foreground-muted"],
                  fontWeight: "600",
                }}
              >
                {t("chat.quota.dismiss")}
              </Typography>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
