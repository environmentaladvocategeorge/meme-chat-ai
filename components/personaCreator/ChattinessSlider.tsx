// A "how chatty" dial bound to the form's `chattiness` field, 1 (curt) to 5
// (chatty). Uses the device-native slider (iOS UISlider) for a familiar,
// system-standard feel; step=1 snaps to the five discrete stages, with the
// active stage named live below the track.

import { Typography } from "@/components/Typography";
import {
  CHATTINESS_DEFAULT,
  CHATTINESS_MAX,
  CHATTINESS_MIN,
  type PersonaFormValues,
} from "@/domain/personaForm";
import { useTheme } from "@/hooks/useTheme";
import Slider from "@react-native-community/slider";
import { useController, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

export function ChattinessSlider() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { control } = useFormContext<PersonaFormValues>();
  const { field } = useController({ control, name: "chattiness" });
  const value = typeof field.value === "number" ? field.value : CHATTINESS_DEFAULT;

  return (
    <View style={{ gap: 6 }}>
      <View style={{ gap: 2 }}>
        <Typography variant="label" style={{ color: theme["--color-foreground"] }}>
          {t("personasCreator.field.chattiness")}
        </Typography>
        <Typography variant="caption" style={{ color: theme["--color-foreground-muted"] }}>
          {t("personasCreator.field.chattinessHint")}
        </Typography>
      </View>

      <Slider
        style={{ width: "100%", height: 40 }}
        minimumValue={CHATTINESS_MIN}
        maximumValue={CHATTINESS_MAX}
        step={1}
        value={value}
        // step=1 already yields integers; round defensively against float drift.
        onValueChange={(v) => field.onChange(Math.round(v))}
        minimumTrackTintColor={theme["--color-primary"]}
        maximumTrackTintColor={theme["--color-border-strong"]}
        // iOS-only: tapping the track jumps the thumb there (no drag required).
        tapToSeek
        accessibilityLabel={t("personasCreator.field.chattiness")}
      />

      {/* End anchors + the active stage name in the middle. */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="caption" style={{ color: theme["--color-foreground-muted"] }}>
          {t(`personasCreator.field.chattinessStage.${CHATTINESS_MIN}`)}
        </Typography>
        <Typography variant="caption" weight="semibold" style={{ color: theme["--color-primary"] }}>
          {t(`personasCreator.field.chattinessStage.${value}`)}
        </Typography>
        <Typography variant="caption" style={{ color: theme["--color-foreground-muted"] }}>
          {t(`personasCreator.field.chattinessStage.${CHATTINESS_MAX}`)}
        </Typography>
      </View>
    </View>
  );
}
