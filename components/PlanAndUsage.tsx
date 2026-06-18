// PlanAndUsage
//
// The shared body of the Plan & Usage view — monthly + daily allowance bars
// followed by the paywall. Rendered both by the /plan route and the global
// PlanSheet bottom sheet so the two stay in lockstep.

import { PlanPaywall } from "@/components/PlanPaywall";
import { Typography } from "@/components/Typography";
import { UsageBar } from "@/components/UsageBar";
import { useTheme } from "@/hooks/useTheme";
import { useEntitlementStore } from "@/store/entitlement";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

export function PlanAndUsage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const entitlement = useEntitlementStore((s) => s.entitlement);

  return (
    <View style={{ gap: 24 }}>
      {entitlement ? (
        <View style={{ gap: 12 }}>
          <View style={{ gap: 16 }}>
            <UsageBar
              title={t("settings.plan.monthlyTitle")}
              remaining={entitlement.creditsRemaining}
              total={entitlement.monthlyCredits}
              resetAt={entitlement.creditsResetAt}
              resetCopyKey="settings.plan.monthlyReset"
            />
            <UsageBar
              title={t("settings.plan.dailyTitle")}
              remaining={Math.max(
                0,
                entitlement.softDailyCredits - entitlement.dailyCreditsUsed,
              )}
              total={entitlement.softDailyCredits}
              resetAt={entitlement.dailyResetAt}
              resetCopyKey="settings.plan.dailyReset"
            />
          </View>
          {/* One shared note instead of repeating it on each bar. */}
          <Typography
            variant="caption"
            style={{ color: theme["--color-foreground-muted"] }}
          >
            {t("settings.plan.usageShared")}
          </Typography>
        </View>
      ) : null}
      <PlanPaywall />
    </View>
  );
}
