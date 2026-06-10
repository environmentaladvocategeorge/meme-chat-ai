// MemorySheet
//
// Brainrot Bot's long-term memory, in the user's voice. Shows what the bot has
// picked up (read-only — the user can clear but never edit), a plain-language
// "what's this" explainer behind an info button, an on/off switch, when it was
// last updated, and a wipe action. Paid feature: free users see a locked state
// that points at plans. Mounted once at the root layout, opened from settings.

import {
  AppPressable,
  SheetTouchableProvider,
} from "@/components/AppPressable";
import { Button } from "@/components/Button";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Typography } from "@/components/Typography";
import { PLAN_RANK } from "@/domain/billing";
import { useMemoryFacts, useMemoryMeta } from "@/hooks/useMemory";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useTheme } from "@/hooks/useTheme";
import {
  clearMemoryCallable,
  setMemoryEnabledCallable,
} from "@/services/firebase/callables";
import { useDisplayPlan } from "@/store/entitlement";
import { useMemorySheetStore } from "@/store/memorySheet";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { Brain, Info, LockKey, Trash, X } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Switch, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
} from "react-native-reanimated";

function FactRow({
  text,
  category,
  onRemove,
  removeLabel,
  muted,
}: {
  text: string;
  category: string;
  onRemove: () => void;
  removeLabel: string;
  muted: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme["--color-border"],
        backgroundColor: theme["--color-card"],
        paddingVertical: 11,
        paddingHorizontal: 13,
        opacity: muted ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Typography
          variant="overline"
          style={{ color: theme["--color-foreground-muted"] }}
        >
          {category}
        </Typography>
        <Typography
          variant="body"
          style={{ color: theme["--color-foreground"] }}
        >
          {text}
        </Typography>
      </View>
      <AppPressable
        onPress={onRemove}
        haptic
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        style={{ padding: 4, marginTop: 1 }}
      >
        <X size={16} weight="bold" color={theme["--color-foreground-muted"]} />
      </AppPressable>
    </View>
  );
}

export function MemorySheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  const isOpen = useMemorySheetStore((s) => s.isOpen);
  const close = useMemorySheetStore((s) => s.close);
  const openPlan = useOpenPlan();

  const plan = useDisplayPlan();
  const isPaid = PLAN_RANK[plan] > PLAN_RANK.free;

  const { meta } = useMemoryMeta();
  const { facts, loading } = useMemoryFacts(isOpen && isPaid);

  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["85%"], []);

  const [showInfo, setShowInfo] = useState(false);
  const [enabled, setEnabled] = useState(meta.enabled);
  const [clearing, setClearing] = useState(false);

  // Keep the optimistic switch in sync with the live doc.
  useEffect(() => {
    setEnabled(meta.enabled);
  }, [meta.enabled]);

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [isOpen]);

  const updatedLabel = useRelativeTime(meta.updatedAt);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop {...props} opacity={0.5} />
    ),
    [],
  );

  const handleToggle = useCallback(
    (next: boolean) => {
      setEnabled(next); // optimistic
      setMemoryEnabledCallable(next).catch(() => {
        setEnabled(!next); // revert on failure
        Alert.alert(t("settings.memory.error"));
      });
    },
    [t],
  );

  const handleRemove = useCallback(
    (id: string) => {
      // Confirm first — a single fact delete is permanent, so a stray tap on the
      // X shouldn't silently wipe a memory.
      Alert.alert(
        t("settings.memory.removeConfirmTitle"),
        t("settings.memory.removeConfirmBody"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("settings.memory.removeConfirmCta"),
            style: "destructive",
            onPress: () => {
              clearMemoryCallable({ factId: id }).catch(() =>
                Alert.alert(t("settings.memory.error")),
              );
            },
          },
        ],
      );
    },
    [t],
  );

  const handleClearAll = useCallback(() => {
    Alert.alert(
      t("settings.memory.clearConfirmTitle"),
      t("settings.memory.clearConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.memory.clearConfirmCta"),
          style: "destructive",
          onPress: () => {
            setClearing(true);
            clearMemoryCallable()
              .catch(() => Alert.alert(t("settings.memory.error")))
              .finally(() => setClearing(false));
          },
        },
      ],
    );
  }, [t]);

  const handleSeePlans = useCallback(() => {
    close();
    openPlan();
  }, [close, openPlan]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={close}
      backgroundStyle={{ backgroundColor: theme["--color-card"] }}
      handleIndicatorStyle={{
        backgroundColor: theme["--color-foreground-muted"],
      }}
    >
      <SheetTouchableProvider>
        <BottomSheetScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            alignItems: "center",
            paddingBottom: 28,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              width: "100%",
              maxWidth: MAX_CONTENT_WIDTH,
              paddingHorizontal: 20,
              gap: 16,
            }}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingTop: 2,
              }}
            >
              <Brain size={24} weight="fill" color={theme["--color-primary"]} />
              <Typography
                variant="title-lg"
                style={{ flex: 1, color: theme["--color-foreground"] }}
              >
                {t("settings.memory.title")}
              </Typography>
              <AppPressable
                onPress={() => setShowInfo((v) => !v)}
                haptic
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t("settings.memory.infoA11y")}
                accessibilityState={{ expanded: showInfo }}
                style={{ padding: 4 }}
              >
                <Info
                  size={22}
                  weight={showInfo ? "fill" : "regular"}
                  color={
                    showInfo
                      ? theme["--color-primary"]
                      : theme["--color-foreground-muted"]
                  }
                />
              </AppPressable>
            </View>

            <Typography
              variant="caption"
              style={{
                color: theme["--color-foreground-muted"],
                marginTop: -8,
              }}
            >
              {t("settings.memory.subtitle")}
            </Typography>

            {/* Plain-language explainer behind the info button */}
            {showInfo ? (
              <Animated.View
                entering={reduceMotion ? undefined : FadeIn.duration(160)}
                exiting={reduceMotion ? undefined : FadeOut.duration(120)}
                style={{
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme["--color-border"],
                  backgroundColor: theme["--color-background"],
                  padding: 14,
                }}
              >
                <Typography
                  variant="body"
                  style={{ color: theme["--color-foreground-secondary"] }}
                >
                  {t("settings.memory.explainer")}
                </Typography>
              </Animated.View>
            ) : null}

            {!isPaid ? (
              /* Locked (no-access) state */
              <View
                style={{
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: theme["--color-border"],
                  backgroundColor: theme["--color-background"],
                  padding: 18,
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <LockKey
                  size={28}
                  weight="fill"
                  color={theme["--color-foreground-muted"]}
                />
                <Typography
                  variant="title-sm"
                  style={{
                    color: theme["--color-foreground"],
                    textAlign: "center",
                  }}
                >
                  {t("settings.memory.lockedTitle")}
                </Typography>
                <Typography
                  variant="body"
                  style={{
                    color: theme["--color-foreground-secondary"],
                    textAlign: "center",
                  }}
                >
                  {t("settings.memory.lockedBody")}
                </Typography>
                <Button
                  title={t("settings.memory.lockedCta")}
                  onPress={handleSeePlans}
                  style={{ alignSelf: "stretch", marginTop: 4 }}
                />
              </View>
            ) : (
              <>
                {/* On/off toggle */}
                <View
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme["--color-border"],
                    backgroundColor: theme["--color-card"],
                    padding: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Typography
                      variant="title-sm"
                      style={{ color: theme["--color-foreground"] }}
                    >
                      {t("settings.memory.toggleLabel")}
                    </Typography>
                    <Typography
                      variant="caption"
                      style={{ color: theme["--color-foreground-secondary"] }}
                    >
                      {t("settings.memory.toggleHint")}
                    </Typography>
                  </View>
                  <Switch
                    value={enabled}
                    onValueChange={handleToggle}
                    accessibilityLabel={t("settings.memory.toggleLabel")}
                    trackColor={{
                      false: theme["--color-background-muted"],
                      true: theme["--color-primary-subtle"],
                    }}
                    thumbColor={
                      enabled
                        ? theme["--color-primary"]
                        : theme["--color-foreground-muted"]
                    }
                  />
                </View>

                {/* Last-updated */}
                <Typography
                  variant="caption"
                  style={{
                    color: theme["--color-foreground-muted"],
                    marginTop: -6,
                  }}
                >
                  {meta.updatedAt
                    ? t("settings.memory.lastUpdated", { when: updatedLabel })
                    : t("settings.memory.neverUpdated")}
                </Typography>

                {/* Facts list */}
                {loading ? (
                  <View style={{ paddingVertical: 28, alignItems: "center" }}>
                    <ActivityIndicator color={theme["--color-primary"]} />
                  </View>
                ) : facts.length === 0 ? (
                  <View
                    style={{
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: theme["--color-border"],
                      backgroundColor: theme["--color-card"],
                      paddingVertical: 28,
                      paddingHorizontal: 16,
                      alignItems: "center",
                      // Dim the whole card when memory is switched off.
                      opacity: enabled ? 1 : 0.5,
                    }}
                  >
                    <Text style={{ fontSize: 30, marginBottom: 8 }}>🧠</Text>
                    <Typography
                      variant="body"
                      style={{
                        color: theme["--color-foreground-muted"],
                        textAlign: "center",
                      }}
                    >
                      {t("settings.memory.empty")}
                    </Typography>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    {facts.map((f) => (
                      <FactRow
                        key={f.id}
                        text={f.text}
                        category={t(`settings.memory.categories.${f.category}`)}
                        muted={!enabled}
                        onRemove={() => handleRemove(f.id)}
                        removeLabel={t("settings.memory.remove")}
                      />
                    ))}
                  </View>
                )}

                {/* Wipe everything */}
                {facts.length > 0 ? (
                  <Button
                    title={t("settings.memory.clear")}
                    onPress={handleClearAll}
                    variant="outline"
                    loading={clearing}
                    startIcon={Trash}
                    style={{ alignSelf: "stretch", marginTop: 4 }}
                  />
                ) : null}
              </>
            )}
          </View>
        </BottomSheetScrollView>
      </SheetTouchableProvider>
    </BottomSheetModal>
  );
}
