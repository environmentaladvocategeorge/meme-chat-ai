// The app's single, centralized color picker, stacked over the Customize Chat
// hub. Whichever of the chat parts the user chose to edit, they land here:
// presets, a custom solid, and a custom gradient all live in ONE view.
//
// The row of swatches always begins with a non-deletable "Default" chip (system
// default for that part) and a "+" that saves the current pick to the front of
// the row; long-pressing a saved swatch enters a delete mode (tap elsewhere to
// leave). The preview composes the user's ACTUAL current chat colors and only
// swaps the part being edited, so the surrounding UI matches the real app.
//
// Gradients are linear-only (no radial render path) — the 8-way Direction lives
// in a compact pill next to Add/Remove stop — and are capped at 3 stops.

import { AppPressable, SheetTouchableProvider } from "@/components/AppPressable";
import { Button } from "@/components/Button";
import { Dropdown, type DropdownOption } from "@/components/Dropdown";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Typography } from "@/components/Typography";
import {
  addGradientPreset,
  addSolidPreset,
  buildPickerGradientSwatches,
  buildPickerSolidSwatches,
  type ChatUiColorRole,
  DEFAULT_BACKGROUND,
  DEFAULT_BUBBLE_STYLE,
  DEFAULT_GRADIENT_DIRECTION,
  deleteGradientPreset,
  deleteSolidPreset,
  type GradientDirection,
  GRADIENT_DIRECTIONS,
  gradientDirectionPoints,
  makeCustomColorId,
  makeCustomGradientId,
  normalizeHex,
  readableGradientTextColor,
  readableTextColor,
  withAlpha,
} from "@/domain/customization";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { useTheme } from "@/hooks/useTheme";
import { useSettingsStore } from "@/store/settings";
import {
  type BottomSheetBackdropProps,
  BottomSheetFooter,
  type BottomSheetFooterProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Check,
  type IconProps,
  List,
  Plus,
  Sparkle,
  Trash,
  X,
} from "phosphor-react-native";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import ColorPicker, {
  type ColorFormatsObject,
  type ColorPickerRef,
  HueSlider,
  InputWidget,
  Panel1,
  Preview,
} from "reanimated-color-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type CustomColorTarget = "bubble" | "background" | ChatUiColorRole;
type CustomMode = "solid" | "gradient";
type TextColorTarget = Extract<ChatUiColorRole, "text" | "userText">;
type TextDraft = { color: string; isDefault: boolean; touched: boolean };

export interface SeedGradient {
  colors: readonly string[];
  direction: GradientDirection;
}

interface CustomColorSheetProps {
  target: CustomColorTarget | null;
  seedColor: string;
  seedGradient?: SeedGradient | null;
  onApply: (id: string) => void;
  onClose: () => void;
}

const EDITOR_HEIGHT = 156;
const MAX_STOPS = 3;
const MIN_STOPS = 2;
const SWATCH = 40;

const DIRECTION_ICON: Record<GradientDirection, ComponentType<IconProps>> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
  "up-right": ArrowUpRight,
  "up-left": ArrowUpLeft,
  "down-right": ArrowDownRight,
  "down-left": ArrowDownLeft,
};

// "up-right" → "upRight" for the i18n key lookup.
function directionKey(direction: GradientDirection): string {
  return direction.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

function isGroupedUiTarget(
  target: CustomColorTarget | null,
): target is ChatUiColorRole {
  return (
    target === "accent" ||
    target === "subtle" ||
    target === "text" ||
    target === "userText"
  );
}

export function CustomColorSheet({
  target,
  seedColor,
  seedGradient,
  onApply,
  onClose,
}: CustomColorSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const chatUiColors = useSettingsStore((s) => s.chatUiColors);
  const setChatUiColor = useSettingsStore((s) => s.setChatUiColor);
  const chatBubbleStyle = useSettingsStore((s) => s.chatBubbleStyle);
  const chatBackground = useSettingsStore((s) => s.chatBackground);
  const insets = useSafeAreaInsets();
  const { bubble: resolvedBubble } = useChatAppearance();

  const sheetRef = useRef<BottomSheetModal>(null);
  // The color field is uncontrolled (it seeds from `value` only at mount), so
  // external color changes — tapping a preset/saved/Default swatch, switching
  // stop or mode, (re)opening — are pushed in imperatively via this ref. A
  // changing `key` (remount) instead made the editor flash/reset on every tap.
  const pickerRef = useRef<ColorPickerRef>(null);
  const snapPoints = useMemo(() => ["90%"], []);

  const seed = normalizeHex(seedColor) ?? seedColor;
  const fallbackGradientEnd =
    normalizeHex(theme["--color-secondary"]) ?? theme["--color-secondary"];
  const uiTarget = isGroupedUiTarget(target) ? target : null;
  const isUiTarget = !!uiTarget;
  const [activeTextRole, setActiveTextRole] = useState<TextColorTarget>("text");
  const editUiTarget = uiTarget === "text" ? activeTextRole : uiTarget;

  const defaultUserText = useMemo(
    () =>
      resolvedBubble.kind === "gradient" && resolvedBubble.gradientColors
        ? readableGradientTextColor(resolvedBubble.gradientColors)
        : readableTextColor(
            resolvedBubble.solidColor ?? theme["--color-primary"],
          ),
    [resolvedBubble, theme],
  );

  const defaultColorForUiTarget = useCallback(
    (role: ChatUiColorRole | null) => {
      const raw =
        role === "subtle"
          ? theme["--color-card"]
          : role === "text"
            ? theme["--color-foreground"]
            : role === "userText"
              ? defaultUserText
              : target === "background"
                ? theme["--color-background"]
                : theme["--color-primary"];
      return normalizeHex(raw) ?? raw;
    },
    [defaultUserText, target, theme],
  );

  // The system default color for this part — the fill of the "Default" swatch
  // and what the editor shows while Default is selected.
  const defaultRep = useMemo(
    () => defaultColorForUiTarget(editUiTarget),
    [defaultColorForUiTarget, editUiTarget],
  );

  const seedStops = useMemo<string[]>(
    () =>
      seedGradient && !uiTarget
        ? seedGradient.colors.map((c) => normalizeHex(c) ?? c)
        : [seed, fallbackGradientEnd],
    [seedGradient, uiTarget, seed, fallbackGradientEnd],
  );
  const seedDirection = seedGradient?.direction ?? DEFAULT_GRADIENT_DIRECTION;
  const startMode: CustomMode = seedGradient && !uiTarget ? "gradient" : "solid";

  const [mode, setMode] = useState<CustomMode>(startMode);
  const [color, setColor] = useState(seed);
  const [stops, setStops] = useState<string[]>(seedStops);
  const [direction, setDirection] = useState<GradientDirection>(seedDirection);
  const [activeStop, setActiveStop] = useState(0);
  // True when the "Default" swatch is selected (revert this part to its system
  // default on apply). Replaces the old "use system color" row.
  const [isDefaultSelected, setIsDefaultSelected] = useState(false);
  // User-saved picks (via "+"), prepended to the row. Component state — the
  // sheet stays mounted, so saves persist for the app session. Separate per mode.
  const [addedSolids, setAddedSolids] = useState<string[]>([]);
  const [addedGradients, setAddedGradients] = useState<string[][]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  // Bumped only by external setters (never the field's own drag), so the field
  // can be re-synced via setColor without fighting the user or remounting.
  const [reseed, setReseed] = useState(0);

  // Mirrors so the apply handler reads the latest pick synchronously on the tap.
  const modeRef = useRef<CustomMode>(startMode);
  const colorRef = useRef(seed);
  const stopsRef = useRef<string[]>(seedStops);
  const directionRef = useRef<GradientDirection>(seedDirection);
  const activeTextRoleRef = useRef<TextColorTarget>("text");
  const textDraftsRef = useRef<Record<TextColorTarget, TextDraft>>({
    text: { color: seed, isDefault: true, touched: false },
    userText: { color: seed, isDefault: true, touched: false },
  });
  const isDefaultRef = useRef(false);
  const touchedRef = useRef(false);

  useEffect(() => {
    if (!target) return;
    const nextTextRole: TextColorTarget = "text";
    const nextUiTarget = uiTarget === "text" ? nextTextRole : uiTarget;
    const textDrafts: Record<TextColorTarget, TextDraft> = {
      text: {
        color: chatUiColors.text ?? defaultColorForUiTarget("text"),
        isDefault: !chatUiColors.text,
        touched: false,
      },
      userText: {
        color: chatUiColors.userText ?? defaultColorForUiTarget("userText"),
        isDefault: !chatUiColors.userText,
        touched: false,
      },
    };
    textDraftsRef.current = textDrafts;
    const nextMode: CustomMode = seedGradient && !uiTarget ? "gradient" : "solid";
    const currentlyDefault = nextUiTarget
      ? !chatUiColors[nextUiTarget]
      : target === "background"
        ? chatBackground === DEFAULT_BACKGROUND
        : chatBubbleStyle === DEFAULT_BUBBLE_STYLE;
    const startColor = currentlyDefault
      ? target === "text"
        ? textDrafts[nextTextRole].color
        : defaultColorForUiTarget(nextUiTarget)
      : nextUiTarget
        ? target === "text"
          ? textDrafts[nextTextRole].color
          : (chatUiColors[nextUiTarget] ?? seed)
        : seed;

    setActiveTextRole(nextTextRole);
    activeTextRoleRef.current = nextTextRole;
    setMode(nextMode);
    modeRef.current = nextMode;
    setColor(startColor);
    colorRef.current = startColor;
    setStops(seedStops);
    stopsRef.current = seedStops;
    setDirection(seedDirection);
    directionRef.current = seedDirection;
    setActiveStop(0);
    setIsDefaultSelected(currentlyDefault);
    isDefaultRef.current = currentlyDefault;
    setDeleteMode(false);
    setReseed((n) => n + 1);
    touchedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    if (target) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [target]);

  const clearDefault = useCallback(() => {
    if (isDefaultRef.current) {
      isDefaultRef.current = false;
      setIsDefaultSelected(false);
    }
  }, []);

  const updateActiveTextDraft = useCallback(
    (patch: Partial<TextDraft>) => {
      if (target !== "text") return;
      const role = activeTextRoleRef.current;
      textDraftsRef.current = {
        ...textDraftsRef.current,
        [role]: {
          ...textDraftsRef.current[role],
          ...patch,
        },
      };
    },
    [target],
  );

  // Write a freshly-edited hex back to the solid color or the active stop.
  const writeEditedColor = useCallback(
    (hex: string, bumpReseed: boolean) => {
      const next = normalizeHex(hex);
      if (!next) return;
      clearDefault();
      touchedRef.current = true;
      if (modeRef.current === "gradient") {
        setStops((prev) => {
          const updated = [...prev];
          updated[activeStop] = next;
          stopsRef.current = updated;
          return updated;
        });
      } else {
        setColor(next);
        colorRef.current = next;
        updateActiveTextDraft({
          color: next,
          isDefault: false,
          touched: true,
        });
      }
      if (bumpReseed) setReseed((n) => n + 1);
    },
    [activeStop, clearDefault, updateActiveTextDraft],
  );

  // The color field drives this on release (its own value updates live).
  const onComplete = useCallback(
    (colors: ColorFormatsObject) => writeEditedColor(colors.hex, false),
    [writeEditedColor],
  );

  const handleModeChange = useCallback(
    (next: CustomMode) => {
      setMode(next);
      modeRef.current = next;
      setActiveStop(0);
      clearDefault();
      touchedRef.current = true;
      setReseed((n) => n + 1);
    },
    [clearDefault],
  );

  const handleSelectStop = useCallback((index: number) => {
    setActiveStop(index);
    setReseed((n) => n + 1);
  }, []);

  const handleAddStop = useCallback(() => {
    setStops((prev) => {
      if (prev.length >= MAX_STOPS) return prev;
      const insertAt = Math.min(activeStop + 1, prev.length);
      const updated = [...prev];
      updated.splice(insertAt, 0, prev[activeStop] ?? prev[prev.length - 1]);
      stopsRef.current = updated;
      setActiveStop(insertAt);
      return updated;
    });
    clearDefault();
    touchedRef.current = true;
    setReseed((n) => n + 1);
  }, [activeStop, clearDefault]);

  const handleRemoveStop = useCallback(() => {
    setStops((prev) => {
      if (prev.length <= MIN_STOPS) return prev;
      const updated = prev.filter((_, i) => i !== activeStop);
      stopsRef.current = updated;
      setActiveStop((s) => Math.max(0, Math.min(s, updated.length - 1)));
      return updated;
    });
    touchedRef.current = true;
    setReseed((n) => n + 1);
  }, [activeStop]);

  const handleDirectionChange = useCallback(
    (next: GradientDirection) => {
      setDirection(next);
      directionRef.current = next;
      clearDefault();
      touchedRef.current = true;
    },
    [clearDefault],
  );

  const handleTextRoleChange = useCallback(
    (next: TextColorTarget) => {
      const nextDraft = textDraftsRef.current[next];

      setActiveTextRole(next);
      activeTextRoleRef.current = next;
      setMode("solid");
      modeRef.current = "solid";
      setColor(nextDraft.color);
      colorRef.current = nextDraft.color;
      setIsDefaultSelected(nextDraft.isDefault);
      isDefaultRef.current = nextDraft.isDefault;
      setDeleteMode(false);
      touchedRef.current = nextDraft.touched;
      setReseed((n) => n + 1);
    },
    [],
  );

  const applySolidPreset = useCallback(
    (hex: string) => {
      const next = normalizeHex(hex) ?? hex;
      setColor(next);
      colorRef.current = next;
      clearDefault();
      touchedRef.current = true;
      updateActiveTextDraft({
        color: next,
        isDefault: false,
        touched: true,
      });
      setReseed((n) => n + 1);
    },
    [clearDefault, updateActiveTextDraft],
  );

  const applyGradientStops = useCallback(
    (next: readonly string[]) => {
      const normalized = next.map((c) => normalizeHex(c) ?? c);
      setStops(normalized);
      stopsRef.current = normalized;
      setActiveStop(0);
      clearDefault();
      touchedRef.current = true;
      setReseed((n) => n + 1);
    },
    [clearDefault],
  );

  // The "Default" swatch: revert this part to its system default on apply, and
  // show the default color in the editor meanwhile.
  const applyDefault = useCallback(() => {
    setIsDefaultSelected(true);
    isDefaultRef.current = true;
    touchedRef.current = true;
    setColor(defaultRep);
    colorRef.current = defaultRep;
    updateActiveTextDraft({
      color: defaultRep,
      isDefault: true,
      touched: true,
    });
    setReseed((n) => n + 1);
  }, [defaultRep, updateActiveTextDraft]);

  // "+" saves the current pick to the FRONT of the row (move-to-front if it
  // already exists, so a value never appears twice).
  const handleAddCurrent = useCallback(() => {
    if (modeRef.current === "gradient") {
      const current = stopsRef.current.slice();
      setAddedGradients((prev) => addGradientPreset(current, prev));
    } else {
      const current = colorRef.current;
      setAddedSolids((prev) => addSolidPreset(current, prev));
    }
  }, []);

  const handleDeleteSolid = useCallback((hex: string) => {
    setAddedSolids((prev) => deleteSolidPreset(hex, prev));
  }, []);
  const handleDeleteGradient = useCallback((key: string) => {
    setAddedGradients((prev) => deleteGradientPreset(key, prev));
  }, []);
  const exitDeleteMode = useCallback(() => setDeleteMode(false), []);

  const handleApplyAndDismiss = useCallback(() => {
    if (target === "text") {
      for (const role of ["text", "userText"] as const) {
        const draft = textDraftsRef.current[role];
        if (!draft.touched) continue;
        setChatUiColor(role, draft.isDefault ? null : draft.color);
      }
      sheetRef.current?.dismiss();
      return;
    }

    const groupedTarget = isGroupedUiTarget(target)
      ? target
      : null;

    if (isDefaultRef.current) {
      if (groupedTarget) setChatUiColor(groupedTarget, null);
      else onApply(target === "background" ? DEFAULT_BACKGROUND : DEFAULT_BUBBLE_STYLE);
    } else if (groupedTarget) {
      setChatUiColor(groupedTarget, colorRef.current);
    } else if (touchedRef.current) {
      onApply(
        modeRef.current === "gradient"
          ? makeCustomGradientId(stopsRef.current, directionRef.current)
          : makeCustomColorId(colorRef.current),
      );
    }
    sheetRef.current?.dismiss();
  }, [onApply, setChatUiColor, target]);

  const handleDiscardAndDismiss = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  const handleDismiss = useCallback(() => {
    onClose();
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop {...props} opacity={0.5} />
    ),
    [],
  );

  const isGradient = mode === "gradient" && !isUiTarget;
  const editingColor = isGradient ? (stops[activeStop] ?? seed) : color;
  const stopsKey = stops.join(":");

  // Push external color changes into the (uncontrolled) field. `reseed` bumps
  // only on external setters — never on the field's own drag.
  const editingColorRef = useRef(editingColor);
  editingColorRef.current = editingColor;
  useEffect(() => {
    pickerRef.current?.setColor(editingColorRef.current, 200);
  }, [reseed]);

  // Leave delete mode automatically once the active mode has nothing to delete.
  const noDeletable = isGradient
    ? addedGradients.length === 0
    : addedSolids.length === 0;
  useEffect(() => {
    if (deleteMode && noDeletable) setDeleteMode(false);
  }, [deleteMode, noDeletable]);

  // Swatches for the active mode: saved picks first, then built-ins — deduped so
  // a value never renders twice (and keys stay unique).
  const solidSwatches = useMemo(
    () => buildPickerSolidSwatches(addedSolids),
    [addedSolids],
  );
  const gradientSwatches = useMemo(
    () => buildPickerGradientSwatches(addedGradients),
    [addedGradients],
  );

  const title =
    target === "accent"
      ? t("settings.customization.customAccentTitle")
      : target === "subtle"
        ? t("settings.customization.customSubtleTitle")
        : target === "text"
          ? t("settings.customization.customTextTitle")
          : target === "background"
            ? t("settings.customization.customBackgroundTitle")
            : t("settings.customization.customBubbleTitle");

  const directionOptions = useMemo<DropdownOption<GradientDirection>[]>(
    () =>
      GRADIENT_DIRECTIONS.map((d) => {
        const Icon = DIRECTION_ICON[d];
        return {
          value: d,
          label: t(`settings.customization.direction.${directionKey(d)}`),
          icon: (
            <Icon size={16} weight="bold" color={theme["--color-foreground"]} />
          ),
        };
      }),
    [t, theme],
  );
  const modeOptions = useMemo(
    () => [
      { value: "solid" as const, label: t("settings.customization.customSolid") },
      {
        value: "gradient" as const,
        label: t("settings.customization.customGradient"),
      },
    ],
    [t],
  );
  const textRoleOptions = useMemo(
    () => [
      {
        value: "text" as const,
        label: t("settings.customization.customTextBot"),
      },
      {
        value: "userText" as const,
        label: t("settings.customization.customTextYou"),
      },
    ],
    [t],
  );

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props} bottomInset={0}>
        <SheetTouchableProvider>
          <View
            style={{
              flexDirection: "row",
              gap: 12,
              width: "100%",
              maxWidth: MAX_CONTENT_WIDTH,
              alignSelf: "center",
              paddingHorizontal: 24,
              paddingTop: 12,
              paddingBottom: insets.bottom + 12,
              borderTopWidth: 1,
              borderTopColor: theme["--color-border"],
              backgroundColor: theme["--color-background-secondary"],
            }}
          >
            <Button
              title={t("common.cancel")}
              onPress={handleDiscardAndDismiss}
              variant="ghost"
              style={{ flex: 1 }}
            />
            <UseColorButton
              isGradient={isGradient && !isDefaultSelected}
              color={isDefaultSelected ? defaultRep : color}
              stops={stops}
              direction={direction}
              label={t("settings.customization.customUse")}
              onPress={handleApplyAndDismiss}
            />
          </View>
        </SheetTouchableProvider>
      </BottomSheetFooter>
    ),
    [
      insets.bottom,
      theme,
      t,
      isGradient,
      isDefaultSelected,
      defaultRep,
      color,
      stops,
      direction,
      handleDiscardAndDismiss,
      handleApplyAndDismiss,
    ],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      enableContentPanningGesture={false}
      backdropComponent={renderBackdrop}
      footerComponent={renderFooter}
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
        backgroundColor: theme["--color-foreground-muted"],
      }}
    >
      <SheetTouchableProvider>
        <BottomSheetScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            width: "100%",
            maxWidth: MAX_CONTENT_WIDTH,
            alignSelf: "center",
            paddingHorizontal: 24,
            paddingTop: 4,
            paddingBottom: insets.bottom + 96,
            gap: 18,
          }}
        >
          {/* Tap-anywhere-else target that leaves delete mode (iOS-style). Sits
              under the preset row (which has a higher zIndex) so swatch taps
              still register while everything else just exits delete mode. */}
          {deleteMode ? (
            <Pressable
              onPress={exitDeleteMode}
              accessibilityLabel={t("common.done")}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1,
              }}
            />
          ) : null}

          <Typography
            variant="title-lg"
            numberOfLines={1}
            style={{
              color: theme["--color-foreground"],
              fontWeight: "800",
              textAlign: "center",
              paddingBottom: 4,
            }}
          >
            {title}
          </Typography>

          {/* Preview — composes the user's actual current colors, only the part
              being edited changes live. */}
          <ContrastPreview
            target={target ?? "bubble"}
            textRole={activeTextRole}
            isGradient={isGradient}
            isDefaultSelected={isDefaultSelected}
            defaultRep={defaultRep}
            color={color}
            stops={stops}
            direction={direction}
          />

          {target === "text" ? (
            <SegmentedControl
              options={textRoleOptions}
              value={activeTextRole}
              onChange={handleTextRoleChange}
            />
          ) : null}

          {!isUiTarget ? (
            <SegmentedControl
              options={modeOptions}
              value={mode}
              onChange={handleModeChange}
            />
          ) : null}

          {/* Presets — Default chip, then the "+" save button, then saved picks,
              then the built-in quick-starts. */}
          <View style={{ gap: 8, zIndex: deleteMode ? 2 : 0 }}>
            <Typography
              variant="label"
              style={{ color: theme["--color-foreground-secondary"] }}
            >
              {t("settings.customization.customPresets")}
            </Typography>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingVertical: 8, paddingRight: 4 }}
            >
              <DefaultSwatch
                color={defaultRep}
                selected={isDefaultSelected}
                onPress={deleteMode ? exitDeleteMode : applyDefault}
                accessibilityLabel={t("settings.customization.customDefault")}
              />
              <AddColorButton
                onPress={deleteMode ? exitDeleteMode : handleAddCurrent}
                accessibilityLabel={t("settings.customization.customSavePick")}
              />
              {isGradient
                ? gradientSwatches.map((g) => {
                    const key = g.join(":");
                    const saved = addedGradients.some(
                      (a) => a.join(":") === key,
                    );
                    return (
                      <PresetSwatch
                        key={g.join("-")}
                        colors={g}
                        selected={!isDefaultSelected && key === stopsKey}
                        showDeleteBadge={deleteMode && saved}
                        onPress={
                          deleteMode
                            ? saved
                              ? () => handleDeleteGradient(key)
                              : exitDeleteMode
                            : () => applyGradientStops(g)
                        }
                        onLongPress={
                          saved ? () => setDeleteMode(true) : undefined
                        }
                        accessibilityLabel={`${t("settings.customization.customPresets")} ${g.join(" ")}`}
                      />
                    );
                  })
                : solidSwatches.map((hex) => {
                    const saved = addedSolids.includes(hex);
                    return (
                      <PresetSwatch
                        key={hex}
                        colors={[hex]}
                        selected={!isDefaultSelected && hex === color}
                        showDeleteBadge={deleteMode && saved}
                        onPress={
                          deleteMode
                            ? saved
                              ? () => handleDeleteSolid(hex)
                              : exitDeleteMode
                            : () => applySolidPreset(hex)
                        }
                        onLongPress={
                          saved ? () => setDeleteMode(true) : undefined
                        }
                        accessibilityLabel={`${t("settings.customization.customPresets")} ${hex}`}
                      />
                    );
                  })}
            </ScrollView>
          </View>

          {/* Gradient-only controls: a compact Direction pill sharing a row with
              Add/Remove stop, then the stop rail. */}
          {isGradient ? (
            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Dropdown
                  compact
                  value={direction}
                  options={directionOptions}
                  onChange={handleDirectionChange}
                  accessibilityLabel={t("settings.customization.customDirection")}
                  style={{ alignSelf: "flex-start" }}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {stops.length > MIN_STOPS ? (
                    <StopAction
                      label={t("settings.customization.customRemoveStop")}
                      icon={Trash}
                      onPress={handleRemoveStop}
                    />
                  ) : null}
                  {stops.length < MAX_STOPS ? (
                    <StopAction
                      label={t("settings.customization.customAddStop")}
                      icon={Plus}
                      onPress={handleAddStop}
                    />
                  ) : null}
                </View>
              </View>
              <GradientStopRail
                stops={stops}
                activeStop={activeStop}
                onSelectStop={handleSelectStop}
              />
            </View>
          ) : null}

          {/* Compact 50/50 color editor: field on the left, hue + hex + swatch
              stacked on the right. */}
          <View style={{ gap: 8 }}>
            <Typography
              variant="label"
              style={{ color: theme["--color-foreground-secondary"] }}
            >
              {isGradient
                ? t("settings.customization.customEditStop")
                : t("settings.customization.customColorEditor")}
            </Typography>
            <ColorPicker
              ref={pickerRef}
              value={editingColor}
              sliderThickness={20}
              thumbSize={24}
              thumbShape="circle"
              boundedThumb
              onCompleteJS={onComplete}
              style={{
                padding: 14,
                borderRadius: 16,
                backgroundColor: theme["--color-card-muted"],
              }}
            >
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Panel1
                  style={{
                    flex: 1,
                    height: EDITOR_HEIGHT,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: theme["--color-border"],
                  }}
                />
                <View
                  style={{
                    flex: 1,
                    height: EDITOR_HEIGHT,
                    justifyContent: "space-between",
                  }}
                >
                  <HueSlider
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: theme["--color-border"],
                    }}
                  />
                  <InputWidget
                    formats={["HEX"]}
                    disableAlphaChannel
                    iconColor={theme["--color-foreground-secondary"]}
                    inputStyle={{
                      color: theme["--color-foreground"],
                      borderColor: theme["--color-border"],
                      backgroundColor: theme["--color-card"],
                      fontWeight: "700",
                    }}
                    inputTitleStyle={{ display: "none" }}
                    iconStyle={{ display: "none" }}
                  />
                  <Preview
                    hideInitialColor
                    hideText
                    style={{ height: 40, borderRadius: 12 }}
                  />
                </View>
              </View>
            </ColorPicker>
          </View>
        </BottomSheetScrollView>
      </SheetTouchableProvider>
    </BottomSheetModal>
  );
}

// The Use color action: a primary button whose fill previews the picked color
// or gradient, so the label sits on exactly what's about to be applied.
function UseColorButton({
  isGradient,
  color,
  stops,
  direction,
  label,
  onPress,
}: {
  isGradient: boolean;
  color: string;
  stops: string[];
  direction: GradientDirection;
  label: string;
  onPress: () => void;
}) {
  const textColor = isGradient
    ? readableGradientTextColor(stops as unknown as readonly [string, string])
    : readableTextColor(color);
  const points = gradientDirectionPoints(direction);

  return (
    <AppPressable
      onPress={onPress}
      haptic
      feedback="opacity"
      accessibilityLabel={label}
      containerStyle={{ flex: 1 }}
      style={{
        height: 48,
        borderRadius: 14,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: isGradient ? undefined : color,
      }}
    >
      {isGradient ? (
        <LinearGradient
          colors={stops as unknown as readonly [string, string, ...string[]]}
          start={points.start}
          end={points.end}
          style={StyleFill}
        />
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Check size={18} weight="bold" color={textColor} />
        <Typography variant="body" weight="bold" style={{ color: textColor }}>
          {label}
        </Typography>
      </View>
    </AppPressable>
  );
}

// A horizontal gradient bar with a selectable handle per stop. The SELECTED
// handle gets the purple accent ring and grows; the others stay neutral-gray.
const HANDLE = 26;
function GradientStopRail({
  stops,
  activeStop,
  onSelectStop,
}: {
  stops: string[];
  activeStop: number;
  onSelectStop: (index: number) => void;
}) {
  const theme = useTheme();
  const [railWidth, setRailWidth] = useState(0);
  const usable = Math.max(0, railWidth - HANDLE);

  return (
    <View
      onLayout={(e) => setRailWidth(e.nativeEvent.layout.width)}
      style={{ height: HANDLE + 14, justifyContent: "center" }}
    >
      <LinearGradient
        colors={stops as unknown as readonly [string, string, ...string[]]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{
          height: 12,
          borderRadius: 999,
          marginHorizontal: HANDLE / 2,
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      />
      {railWidth > 0
        ? stops.map((stopColor, index) => {
            const position = stops.length > 1 ? index / (stops.length - 1) : 0;
            const selected = index === activeStop;
            return (
              <AppPressable
                key={`${index}-${stopColor}`}
                onPress={() => onSelectStop(index)}
                feedback="scale"
                pressScale={0.12}
                hitSlop={12}
                accessibilityLabel={`Stop ${index + 1}`}
                accessibilityState={{ selected }}
                containerStyle={{
                  position: "absolute",
                  left: position * usable,
                  width: HANDLE,
                  height: HANDLE,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                style={{
                  width: selected ? HANDLE : HANDLE - 4,
                  height: selected ? HANDLE : HANDLE - 4,
                  borderRadius: HANDLE / 2,
                  backgroundColor: stopColor,
                  borderWidth: 3,
                  borderColor: selected
                    ? theme["--color-primary"]
                    : theme["--color-foreground-muted"],
                }}
              >
                <View />
              </AppPressable>
            );
          })
        : null}
    </View>
  );
}

function StopAction({
  label,
  icon: Icon,
  onPress,
}: {
  label: string;
  icon: ComponentType<IconProps>;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      feedback="opacity"
      haptic
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
      }}
    >
      <Icon size={14} weight="bold" color={theme["--color-foreground-secondary"]} />
      <Typography
        variant="label"
        style={{ color: theme["--color-foreground-secondary"] }}
      >
        {label}
      </Typography>
    </AppPressable>
  );
}

// The non-deletable "Default" chip — reverts this part to its system default.
function DefaultSwatch({
  color,
  selected,
  onPress,
  accessibilityLabel,
}: {
  color: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      feedback="scale"
      pressScale={0.1}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      style={{
        width: SWATCH,
        height: SWATCH,
        borderRadius: SWATCH / 2,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color,
        borderWidth: 2,
        borderColor: selected ? theme["--color-primary"] : theme["--color-border"],
      }}
    >
      <View
        style={{
          ...StyleFill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.18)",
        }}
      >
        <Sparkle size={16} weight="fill" color={readableTextColor(color)} />
      </View>
    </AppPressable>
  );
}

// The "+" button: saves the current pick to the front of the row.
function AddColorButton({
  onPress,
  accessibilityLabel,
}: {
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      haptic
      feedback="scale"
      pressScale={0.1}
      accessibilityLabel={accessibilityLabel}
      style={{
        width: SWATCH,
        height: SWATCH,
        borderRadius: SWATCH / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme["--color-card"],
        borderWidth: 2,
        borderStyle: "dashed",
        borderColor: theme["--color-border"],
      }}
    >
      <Plus size={18} weight="bold" color={theme["--color-foreground-secondary"]} />
    </AppPressable>
  );
}

// A preset/saved chip — always a circle. Solids fill flat; gradients fill with a
// diagonal sweep. Selected chips get the accent ring + a check; in delete mode a
// saved chip shows a red delete badge.
function PresetSwatch({
  colors,
  selected,
  showDeleteBadge,
  onPress,
  onLongPress,
  accessibilityLabel,
}: {
  colors: readonly string[];
  selected: boolean;
  showDeleteBadge?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const isGradient = colors.length > 1;
  const onColor = isGradient
    ? readableGradientTextColor(colors as unknown as readonly [string, string])
    : readableTextColor(colors[0]);

  const badgeOpacity = useSharedValue(showDeleteBadge ? 1 : 0);
  useEffect(() => {
    badgeOpacity.value = withTiming(showDeleteBadge ? 1 : 0, { duration: 180 });
  }, [showDeleteBadge, badgeOpacity]);
  const badgeStyle = useAnimatedStyle(() => ({ opacity: badgeOpacity.value }));

  return (
    <AppPressable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="scale"
      pressScale={0.1}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      style={{ width: SWATCH, height: SWATCH }}
    >
      {/* Circular clip layer — overflow:hidden lives here so the badge
          (a sibling below) is not clipped by the rounded shape. */}
      <View
        style={{
          ...StyleFill,
          borderRadius: SWATCH / 2,
          overflow: "hidden",
          backgroundColor: isGradient ? undefined : colors[0],
          borderWidth: 2,
          borderColor: selected ? theme["--color-primary"] : theme["--color-border"],
        }}
      >
        {isGradient ? (
          <LinearGradient
            colors={colors as unknown as readonly [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleFill}
          />
        ) : null}
        {selected && !showDeleteBadge ? (
          <View
            style={{
              ...StyleFill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(0,0,0,0.22)",
            }}
          >
            <Check size={16} weight="bold" color={onColor} />
          </View>
        ) : null}
      </View>
      {/* Badge sits outside the overflow:hidden layer so it renders fully
          at the top-right corner without being clipped. Always rendered
          so the fade-out can complete before it disappears. */}
      <Animated.View
        pointerEvents="none"
        style={[
          badgeStyle,
          {
            position: "absolute",
            top: -5,
            right: -5,
            width: 18,
            height: 18,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#FF3B30",
          },
        ]}
      >
        <X size={11} weight="bold" color="#FFFFFF" />
      </Animated.View>
    </AppPressable>
  );
}

// Live preview. Pulls the user's ACTUAL resolved chat colors and swaps only the
// part being edited (or its system default while Default is selected), so the
// surrounding UI matches the real app instead of generic theme colors.
function ContrastPreview({
  target,
  textRole,
  isGradient,
  isDefaultSelected,
  defaultRep,
  color,
  stops,
  direction,
}: {
  target: CustomColorTarget;
  textRole: TextColorTarget;
  isGradient: boolean;
  isDefaultSelected: boolean;
  defaultRep: string;
  color: string;
  stops: string[];
  direction: GradientDirection;
}) {
  const { t } = useTranslation();
  const { bubble, background, chatTheme } = useChatAppearance();
  const points = gradientDirectionPoints(direction);
  const liveStops = stops as unknown as readonly [string, string, ...string[]];

  // Background.
  const editBgGradient =
    target === "background" && isGradient && !isDefaultSelected;
  const backgroundGradient = editBgGradient
    ? liveStops
    : target === "background"
      ? null
      : background.kind === "gradient"
        ? background.gradientColors
        : null;
  const backgroundGradientPoints =
    target === "background"
      ? points
      : {
          start: background.gradientStart ?? { x: 0, y: 0 },
          end: background.gradientEnd ?? { x: 0, y: 1 },
        };
  const backgroundFill =
    target === "background"
      ? isDefaultSelected
        ? defaultRep
        : color
      : (background.color ?? chatTheme["--color-background"]);

  // User bubble.
  const editBubbleGradient =
    target === "bubble" && isGradient && !isDefaultSelected;
  const bubbleGradient = editBubbleGradient
    ? liveStops
    : target === "bubble"
      ? null
      : bubble.kind === "gradient"
        ? bubble.gradientColors
        : null;
  const bubbleGradientPoints =
    target === "bubble"
      ? points
      : {
          start: bubble.gradientStart ?? { x: 0, y: 0 },
          end: bubble.gradientEnd ?? { x: 0, y: 1 },
        };
  const bubbleFill =
    target === "bubble"
      ? isDefaultSelected
        ? defaultRep
        : color
      : (bubble.solidColor ?? chatTheme["--color-primary"]);
  // Text (and placeholder as an opacity of it).
  const editsBotText = target === "text" && textRole === "text";
  const editsUserText = target === "text" && textRole === "userText";
  const textColor =
    editsBotText
      ? isDefaultSelected
        ? defaultRep
        : color
      : chatTheme["--color-foreground"];
  const mutedText =
    editsBotText ? withAlpha(textColor, 0.45) : chatTheme["--color-foreground-muted"];
  const bubbleText =
    editsUserText
      ? isDefaultSelected
        ? defaultRep
        : color
      : target === "bubble"
        ? bubbleGradient
          ? readableGradientTextColor(bubbleGradient)
          : readableTextColor(bubbleFill)
        : bubble.textColor;

  // Agent surface + accent.
  const agentFill =
    target === "subtle"
      ? isDefaultSelected
        ? defaultRep
        : color
      : chatTheme["--color-card"];
  const agentText = target === "subtle" ? readableTextColor(agentFill) : textColor;
  const accentFill =
    target === "accent"
      ? isDefaultSelected
        ? defaultRep
        : color
      : chatTheme["--color-primary"];
  const accentText = readableTextColor(accentFill);
  const border = chatTheme["--color-border"];

  return (
    <View
      style={{
        borderRadius: 16,
        overflow: "hidden",
        padding: 14,
        gap: 10,
        backgroundColor: backgroundFill,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      {backgroundGradient ? (
        <LinearGradient
          colors={backgroundGradient}
          start={backgroundGradientPoints.start}
          end={backgroundGradientPoints.end}
          style={StyleFill}
        />
      ) : null}
      <View
        style={{
          borderRadius: 18,
          paddingHorizontal: 10,
          paddingVertical: 8,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: agentFill,
          borderWidth: 1,
          borderColor: border,
        }}
      >
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: accentFill,
          }}
        >
          <List size={15} weight="bold" color={accentText} />
        </View>
        <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 8 }}>
          <Typography
            variant="body"
            weight="bold"
            numberOfLines={1}
            style={{ color: textColor, fontSize: 15 }}
          >
            {t("chat.title")}
          </Typography>
        </View>
        <View
          style={{
            width: 30,
            height: 30,
          }}
        />
      </View>
      <View
        style={{
          alignSelf: "flex-start",
          maxWidth: "85%",
          borderRadius: 16,
          borderBottomLeftRadius: 5,
          paddingHorizontal: 12,
          paddingVertical: 9,
          backgroundColor: agentFill,
          borderWidth: 1,
          borderColor: border,
        }}
      >
        <Typography
          variant="body-sm"
          style={{ color: agentText, fontSize: 14, lineHeight: 19 }}
        >
          {t("settings.customization.previewAgent")}
        </Typography>
      </View>
      <View
        style={{
          alignSelf: "flex-end",
          maxWidth: "82%",
          borderRadius: 18,
          borderBottomRightRadius: 5,
          overflow: "hidden",
          backgroundColor: bubbleGradient ? undefined : bubbleFill,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        {bubbleGradient ? (
          <LinearGradient
            colors={bubbleGradient}
            start={bubbleGradientPoints.start}
            end={bubbleGradientPoints.end}
            style={StyleFill}
          />
        ) : null}
        <Typography
          variant="body-sm"
          style={{ color: bubbleText, fontSize: 14, lineHeight: 19 }}
        >
          {t("settings.customization.previewUser")}
        </Typography>
      </View>
      <View
        style={{
          height: 38,
          borderRadius: 19,
          paddingLeft: 14,
          paddingRight: 5,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: agentFill,
          borderWidth: 1,
          borderColor: border,
        }}
      >
        <Typography
          variant="body-sm"
          numberOfLines={1}
          style={{ flex: 1, color: mutedText, fontSize: 13 }}
        >
          {t("settings.customization.previewPlaceholder")}
        </Typography>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: accentFill,
            overflow: "hidden",
          }}
        >
          <Check size={14} weight="bold" color={accentText} />
        </View>
      </View>
    </View>
  );
}

const StyleFill = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
