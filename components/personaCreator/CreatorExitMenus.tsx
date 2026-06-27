// The persona creator's two header popovers:
//   - ExitMenu (the X, top-right): Save draft / Discard (create) or Discard
//     changes (edit).
//   - SaveMenu (the floppy icon, top-left, edit only): Save changes / Save & exit.
// Both share the same dim backdrop + drop-and-scale entrance, anchored under
// their header button.

import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { OverlayBackdrop } from "@/components/OverlayModal";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { FloppyDisk, SignOut, Trash } from "phosphor-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// Shared mount + entrance animation for both popovers. Returns the mounted flag
// (drives unmount after the exit) and the backdrop/panel animated styles.
function usePopoverAnimation(open: boolean) {
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withTiming(1, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
      });
    } else if (mounted) {
      progress.value = withTiming(
        0,
        { duration: 140, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
  }, [open, mounted, progress]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.4,
  }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [-8, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.94, 1]) },
    ],
  }));

  return { mounted, backdropStyle, panelStyle };
}

export function ExitMenu({
  open,
  isEdit,
  onClose,
  onSaveDraft,
  onDiscard,
}: {
  open: boolean;
  // Edit mode has no draft: the menu drops "Save draft" and the discard row
  // becomes "Discard changes" (the screen only opens it when there ARE changes).
  isEdit: boolean;
  onClose: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { mounted, backdropStyle, panelStyle } = usePopoverAnimation(open);

  if (!mounted) return null;

  return (
    <View
      pointerEvents={open ? "auto" : "none"}
      style={StyleSheet.absoluteFillObject}
    >
      <OverlayBackdrop onPress={onClose} animatedStyle={backdropStyle} />

      {/* Anchored just under the header's X button (which sits at the top of the
          safe-area inset + the header's 8px pad + 36px button). */}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: insets.top + 44,
            right: 16,
            minWidth: 220,
            transformOrigin: "top right",
          },
          panelStyle,
        ]}
      >
        <GlassSurface
          style={{ borderRadius: 18, overflow: "hidden" }}
          fallbackStyle={{
            backgroundColor: theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-border"],
          }}
        >
          <Typography
            variant="caption"
            weight="semibold"
            style={{
              color: theme["--color-foreground-muted"],
              paddingHorizontal: 16,
              paddingTop: 14,
              paddingBottom: 6,
            }}
          >
            {isEdit
              ? t("personasCreator.editExitTitle")
              : t("personasCreator.exitTitle")}
          </Typography>
          {isEdit ? null : (
            <>
              <ExitRow
                icon={
                  <FloppyDisk
                    size={18}
                    weight="bold"
                    color={theme["--color-foreground"]}
                  />
                }
                label={t("personasCreator.saveDraft")}
                color={theme["--color-foreground"]}
                onPress={onSaveDraft}
              />
              <Divider theme={theme} />
            </>
          )}
          <ExitRow
            icon={
              <Trash size={18} weight="bold" color={theme["--color-error"]} />
            }
            label={
              isEdit
                ? t("personasCreator.discardChanges")
                : t("personasCreator.discardDraft")
            }
            color={theme["--color-error"]}
            onPress={onDiscard}
          />
        </GlassSurface>
      </Animated.View>
    </View>
  );
}

export function SaveMenu({
  open,
  onClose,
  onSaveChanges,
  onSaveAndExit,
}: {
  open: boolean;
  onClose: () => void;
  onSaveChanges: () => void;
  onSaveAndExit: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { mounted, backdropStyle, panelStyle } = usePopoverAnimation(open);

  if (!mounted) return null;

  return (
    <View
      pointerEvents={open ? "auto" : "none"}
      style={StyleSheet.absoluteFillObject}
    >
      <OverlayBackdrop onPress={onClose} animatedStyle={backdropStyle} />

      {/* Anchored just under the header's save (floppy) button, top-left. */}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: insets.top + 44,
            left: 16,
            minWidth: 220,
            transformOrigin: "top left",
          },
          panelStyle,
        ]}
      >
        <GlassSurface
          style={{ borderRadius: 18, overflow: "hidden" }}
          fallbackStyle={{
            backgroundColor: theme["--color-card"],
            borderWidth: 1,
            borderColor: theme["--color-border"],
          }}
        >
          <ExitRow
            icon={
              <FloppyDisk
                size={18}
                weight="bold"
                color={theme["--color-foreground"]}
              />
            }
            label={t("personasCreator.saveChanges")}
            color={theme["--color-foreground"]}
            onPress={onSaveChanges}
          />
          <Divider theme={theme} />
          <ExitRow
            icon={
              <SignOut
                size={18}
                weight="bold"
                color={theme["--color-foreground"]}
              />
            }
            label={t("personasCreator.saveAndExit")}
            color={theme["--color-foreground"]}
            onPress={onSaveAndExit}
          />
        </GlassSurface>
      </Animated.View>
    </View>
  );
}

function Divider({ theme }: { theme: ReturnType<typeof useTheme> }) {
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme["--color-border"],
        marginHorizontal: 16,
      }}
    />
  );
}

function ExitRow({
  icon,
  label,
  color,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <AppPressable
      onPress={onPress}
      accessibilityLabel={label}
      pressScale={0.02}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      {icon}
      <Typography variant="body" weight="semibold" style={{ color }}>
        {label}
      </Typography>
    </AppPressable>
  );
}
