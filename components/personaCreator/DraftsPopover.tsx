// DraftsPopover
//
// A glass popover that drops from the "Drafts (N)" pill in the persona picker's
// section header. Lists the user's in-progress local drafts — each with the
// time it was last updated and an X to discard — and resumes one on tap.
//
// Mounted inside the PersonaSheet content (shares its coordinate space), so it
// anchors right below the header row via a measured `anchorTop`. The panel is
// glass, so its entrance is transform-only (scale + slide); never an opacity
// fade — fading a glass subtree through 0 permanently blanks the material (see
// GlassSurface's opacity-0 note). Only the (non-glass) backdrop dimmer fades.

import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { IconButton } from "@/components/IconButton";
import { OverlayBackdrop, OverlayModal } from "@/components/OverlayModal";
import { Typography } from "@/components/Typography";
import type { PersonaDraft } from "@/domain/personaDrafts";
import { Image } from "expo-image";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useTheme } from "@/hooks/useTheme";
import { X } from "phosphor-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export function DraftsPopover({
  open,
  anchorTop,
  drafts,
  onResume,
  onDiscard,
  onClose,
}: {
  open: boolean;
  // Y (within the sheet content) of the header row's bottom edge — the panel
  // drops from just below it.
  anchorTop: number;
  drafts: PersonaDraft[];
  onResume: (id: string) => void;
  onDiscard: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  // Keep the overlay mounted through the exit animation, then unmount.
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withTiming(1, {
        duration: 200,
        easing: Easing.out(Easing.cubic),
      });
    } else if (mounted) {
      progress.value = withTiming(
        0,
        { duration: 150, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
  }, [open, mounted, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  // Transform-only (glass-safe): a small drop + scale from the top-right anchor.
  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [-8, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.94, 1]) },
    ],
  }));

  if (!mounted) return null;

  // A native Modal so the dim backdrop covers the WHOLE window, not just the
  // sheet's 80% bounds (an in-sheet absoluteFill only fills the sheet). The
  // anchor is passed in WINDOW coordinates. GestureHandlerRootView lets the
  // AppPressables inside still register (they inherit the sheet's gesture-handler
  // touch core, which needs a root view inside the Modal's separate window).
  return (
    <OverlayModal visible onRequestClose={onClose} withGestureRoot>
      <View
        pointerEvents={open ? "auto" : "none"}
        style={StyleSheet.absoluteFillObject}
      >
        <OverlayBackdrop onPress={onClose} animatedStyle={backdropStyle} />

        <Animated.View
          style={[
            {
              position: "absolute",
              top: anchorTop + 8,
              left: 16,
              right: 16,
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
                paddingBottom: 4,
              }}
            >
              {t("personasCreator.draftsTitle")}
            </Typography>
            <View style={{ paddingVertical: 4 }}>
              {drafts.map((draft, i) => (
                <DraftRow
                  key={draft.id}
                  draft={draft}
                  showDivider={i > 0}
                  onResume={() => onResume(draft.id)}
                  onDiscard={() => onDiscard(draft.id)}
                />
              ))}
            </View>
          </GlassSurface>
        </Animated.View>
      </View>
    </OverlayModal>
  );
}

function DraftRow({
  draft,
  showDivider,
  onResume,
  onDiscard,
}: {
  draft: PersonaDraft;
  showDivider: boolean;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const relative = useRelativeTime(new Date(draft.updatedAt));
  const name =
    draft.values.displayName.trim() || t("personasCreator.untitledDraft");
  const monogram = (
    draft.values.displayName.trim().charAt(0) || "?"
  ).toUpperCase();

  // Discarding a draft is destructive and can't be undone, so confirm first.
  const confirmDiscard = useCallback(() => {
    Alert.alert(
      t("personasCreator.discardConfirmTitle"),
      t("personasCreator.discardConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("personasCreator.discardDraft"),
          style: "destructive",
          onPress: onDiscard,
        },
      ],
    );
  }, [t, onDiscard]);

  return (
    <View>
      {showDivider ? (
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme["--color-border"],
            marginHorizontal: 16,
          }}
        />
      ) : null}
      {/* The resume tap and the discard X are SIBLINGS, not nested — a nested X
          fired both its own press and the row's onResume (and skipped the
          confirm). The row content flexes; the X sits beside it. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <AppPressable
          onPress={onResume}
          accessibilityLabel={`${t("personasCreator.resumeDraft")}: ${name}`}
          pressScale={0.02}
          containerStyle={{ flex: 1 }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* The draft's picked/generated avatar if it has one, else a monogram. */}
          {draft.avatar?.localUri ? (
            <Image
              source={{ uri: draft.avatar.localUri }}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: theme["--color-card-muted"],
              }}
              contentFit="cover"
            />
          ) : (
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme["--color-card-muted"],
              }}
            >
              <Typography
                variant="body"
                weight="semibold"
                style={{ color: theme["--color-foreground"] }}
              >
                {monogram}
              </Typography>
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Typography
              variant="body"
              weight="semibold"
              numberOfLines={1}
              style={{ color: theme["--color-foreground"] }}
            >
              {name}
            </Typography>
            <Typography
              variant="caption"
              style={{ color: theme["--color-foreground-muted"] }}
            >
              {t("personasCreator.draftUpdated", { time: relative })}
            </Typography>
          </View>
        </AppPressable>
        <IconButton
          onPress={confirmDiscard}
          size={32}
          hitSlop={8}
          surfaceStyle={{ backgroundColor: theme["--color-card-muted"] }}
          accessibilityLabel={t("personasCreator.discardDraft")}
        >
          <X
            size={15}
            weight="bold"
            color={theme["--color-foreground-muted"]}
          />
        </IconButton>
      </View>
    </View>
  );
}
