// Global Plan & Usage bottom sheet. Mounted once in the root layout and driven
// by usePlanSheetStore, so the paywall + usage view can be summoned from
// anywhere (chat nudges, the quota modal, settings) without a route change.

import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
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
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function PlanSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const isOpen = usePlanSheetStore((s) => s.isOpen);
  const close = usePlanSheetStore((s) => s.close);

  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["92%"], []);

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
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={close}
      backgroundStyle={{
        backgroundColor: theme["--color-background-secondary"],
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
      }}
      handleIndicatorStyle={{
        width: 40,
        height: 4,
        borderRadius: 999,
        backgroundColor: theme["--color-border"],
      }}
    >
      <BottomSheetScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          // The sheet itself is full-width; on wide screens (iPad) constrain
          // and center the content to the same column as the rest of the app.
          width: "100%",
          maxWidth: MAX_CONTENT_WIDTH,
          alignSelf: "center",
          paddingHorizontal: 24,
          paddingTop: 6,
          paddingBottom: insets.bottom + 32,
          gap: 20,
        }}
      >
        <Typography
          variant="title-xl"
          style={{ color: theme["--color-foreground"], fontWeight: "800" }}
        >
          {t("settings.plan.heading")}
        </Typography>
        <PlanAndUsage />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
