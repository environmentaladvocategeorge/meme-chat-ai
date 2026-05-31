// A focused "pick your own color" bottom sheet, stacked on top of the Customize
// Chat sheet. It wraps `reanimated-color-picker` in our own themed chrome and a
// live preview that demonstrates the automatic contrast detection: whatever
// color the user lands on, the sample text / chat chrome around it is recolored
// to whichever on-color reads best (see readableTextColor / resolveBackground
// Surface in domain/customization).

import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Typography } from "@/components/Typography";
import {
  makeCustomColorId,
  normalizeHex,
  readableTextColor,
  resolveBackgroundSurface,
} from "@/domain/customization";
import { useTheme } from "@/hooks/useTheme";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  TouchableOpacity as BottomSheetTouchableOpacity,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { Check } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import ColorPicker, {
  type ColorFormatsObject,
  HueSlider,
  Panel1,
  Preview,
} from "reanimated-color-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type CustomColorTarget = "bubble" | "background";

interface CustomColorSheetProps {
  // Which control we're picking for; null keeps the sheet dismissed.
  target: CustomColorTarget | null;
  // The color to open on (the current pick, or a sensible default).
  seedColor: string;
  // Commits a #RRGGBB pick (fired as the user releases the sliders).
  onApply: (hex: string) => void;
  onClose: () => void;
}

const PANEL_HEIGHT = 200;

export function CustomColorSheet({
  target,
  seedColor,
  onApply,
  onClose,
}: CustomColorSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["80%"], []);

  const seed = normalizeHex(seedColor) ?? seedColor;

  // The pick is kept LOCAL while the sheet is open and committed once on close,
  // so the parent's stored value (and therefore the ColorPicker's seed/key)
  // never changes mid-session — that would remount the picker on every release.
  // `color` drives the live preview scene; the refs are read by the close
  // handler, which fires outside React's render so it needs the latest values.
  const [color, setColor] = useState(seed);
  const colorRef = useRef(seed);
  const touchedRef = useRef(false);

  useEffect(() => {
    if (!target) return;
    setColor(seed);
    colorRef.current = seed;
    touchedRef.current = false;
  }, [target, seed]);

  useEffect(() => {
    if (target) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [target]);

  // Non-worklet completion handler: normalize to #RRGGBB and refresh the local
  // preview. Marks the session "touched" so a no-op open doesn't overwrite a
  // preset selection with a custom color.
  const onComplete = useCallback((colors: ColorFormatsObject) => {
    const hex = normalizeHex(colors.hex);
    if (!hex) return;
    setColor(hex);
    colorRef.current = hex;
    touchedRef.current = true;
  }, []);

  // Commit on close (Done button, pan-down, or backdrop tap all route here).
  const handleDismiss = useCallback(() => {
    if (touchedRef.current) onApply(colorRef.current);
    onClose();
  }, [onApply, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop {...props} opacity={0.5} />
    ),
    [],
  );

  const title =
    target === "background"
      ? t("settings.customization.customBackgroundTitle")
      : t("settings.customization.customBubbleTitle");

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      // The 2D panel owns vertical drags, so don't let the sheet hijack them as
      // pan-to-close — users dismiss via the handle/backdrop instead.
      enableContentPanningGesture={false}
      backdropComponent={renderBackdrop}
      onDismiss={handleDismiss}
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
      <BottomSheetView
        style={{
          width: "100%",
          maxWidth: MAX_CONTENT_WIDTH,
          alignSelf: "center",
          paddingHorizontal: 24,
          paddingTop: 4,
          paddingBottom: insets.bottom + 24,
          gap: 20,
        }}
      >
        <Typography
          variant="title-lg"
          style={{ color: theme["--color-foreground"], fontWeight: "800" }}
        >
          {title}
        </Typography>

        <ContrastPreview target={target ?? "bubble"} color={color} />

        {/* The picker is uncontrolled after mount; `value` is only its initial
            seed. Keyed by target+seed so re-opening (or opening for the other
            control) remounts it on the right starting color, while staying
            stable during a session since we don't commit until close. */}
        <ColorPicker
          key={`${target}:${seed}`}
          value={seed}
          sliderThickness={22}
          thumbSize={26}
          thumbShape="circle"
          boundedThumb
          onCompleteJS={onComplete}
          style={{ gap: 18 }}
        >
          <Preview
            hideInitialColor
            hideText
            style={{ height: 40, borderRadius: 12 }}
          />
          <Panel1
            style={{
              height: PANEL_HEIGHT,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme["--color-border"],
            }}
          />
          <HueSlider
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme["--color-border"],
            }}
          />
        </ColorPicker>

        <BottomSheetTouchableOpacity
          onPress={() => sheetRef.current?.dismiss()}
          accessibilityRole="button"
          accessibilityLabel={t("settings.customization.customDone")}
          activeOpacity={0.85}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: theme["--color-primary"],
          }}
        >
          <Check
            size={18}
            weight="bold"
            color={theme["--color-primary-foreground"]}
          />
          <Typography
            variant="body"
            weight="bold"
            style={{ color: theme["--color-primary-foreground"] }}
          >
            {t("settings.customization.customDone")}
          </Typography>
        </BottomSheetTouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

// A tiny scene that re-derives its on-colors from the picked color, so the
// auto-contrast behavior is visible before the user commits. For a bubble we
// show the message fill with auto text; for a background we show the synthesized
// chat surface (agent card) sitting on the chosen backdrop.
function ContrastPreview({
  target,
  color,
}: {
  target: CustomColorTarget;
  color: string;
}) {
  const { t } = useTranslation();

  if (target === "bubble") {
    const textColor = readableTextColor(color);
    return (
      <View style={{ alignItems: "flex-end" }}>
        <View
          style={{
            maxWidth: "85%",
            borderRadius: 18,
            borderBottomRightRadius: 5,
            paddingHorizontal: 14,
            paddingVertical: 10,
            backgroundColor: color,
          }}
        >
          <Typography
            variant="body"
            style={{ color: textColor, fontSize: 15, lineHeight: 20 }}
          >
            {t("settings.customization.previewUser")}
          </Typography>
        </View>
      </View>
    );
  }

  // Background preview: backdrop + a synthesized agent card on top of it.
  const surface = resolveBackgroundSurface(makeCustomColorId(color));
  return (
    <View
      style={{
        borderRadius: 16,
        overflow: "hidden",
        padding: 14,
        backgroundColor: color,
      }}
    >
      <View
        style={{
          alignSelf: "flex-start",
          maxWidth: "85%",
          borderRadius: 16,
          borderBottomLeftRadius: 5,
          paddingHorizontal: 12,
          paddingVertical: 9,
          backgroundColor: surface?.surface ?? "#FFFFFFCC",
          borderWidth: 1,
          borderColor: surface?.surfaceBorder ?? "transparent",
        }}
      >
        <Typography
          variant="body-sm"
          style={{
            color: surface?.surfaceText ?? "#17131F",
            fontSize: 14,
            lineHeight: 19,
          }}
        >
          {t("settings.customization.previewAgent")}
        </Typography>
      </View>
    </View>
  );
}
