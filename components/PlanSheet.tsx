// PlanSheet
//
// Global Plan & Usage bottom sheet. Mounted once in the (app) layout and
// driven by usePlanSheetStore, so the paywall + usage view can be summoned
// from anywhere (chat nudges, the quota modal, settings) without a route
// change.
//
// Sizing mirrors the proven pattern from the hobby-dex BottomSheetPicker:
// dynamic content sizing capped at ~90% of the screen, NO fixed snapPoints
// (fixed percentage snap points + a scroll view rendered the sheet invisible).

import { PlanAndUsage } from "@/components/PlanAndUsage";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { usePlanSheetStore } from "@/store/planSheet";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function PlanSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const isOpen = usePlanSheetStore((s) => s.isOpen);
  const close = usePlanSheetStore((s) => s.close);
  const sheetRef = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [isOpen]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      maxDynamicContentSize={screenHeight * 0.92}
      enablePanDownToClose
      onDismiss={close}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme["--color-background"] }}
      handleIndicatorStyle={{
        width: 40,
        height: 4,
        borderRadius: 999,
        backgroundColor: theme["--color-foreground-muted"],
      }}
    >
      <BottomSheetScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 6,
          paddingBottom: insets.bottom + 32,
          gap: 20,
        }}
      >
        <View>
          <Typography
            variant="title-xl"
            style={{ color: theme["--color-foreground"], fontWeight: "800" }}
          >
            {t("settings.plan.heading")}
          </Typography>
        </View>
        <PlanAndUsage />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
