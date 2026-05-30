// RotLevelSheet
//
// The "Rot Level" picker — a bottom sheet built around a horizontal pill rail.
// Drag (or tap) RIGHT to crank the brainrot, LEFT to calm it. The control
// snaps to three detents: Lightly Cooked / Rotted / Goblin Mode.
//
// Design intent is "quiet and tactile", not "animated demo": a muted rail with
// a soft brand-colored fill that grows left→right, three understated detents,
// and a thumb that only lifts while you're actually touching it. There is no
// always-running motion — every animation is driven by direct interaction and
// settles to rest. The selected level's name + description live BELOW the rail
// in a fixed-height block so the Done button never shifts as copy changes.
//
// Architecture: gesture-driven values stay on the UI runtime (Reanimated
// shared values + Gesture Handler). We only cross back to JS when the discrete
// level changes during a drag, or to commit the final selection. The parent
// owns the value; this sheet just edits it via `level` / `onChange`.

import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { Typography } from "@/components/Typography";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export type RotLevelSheetRef = {
  present: () => void;
  dismiss: () => void;
};

interface RotLevelSheetProps {
  // Current level (1–3). Owned by the parent.
  level: number;
  onChange: (level: number) => void;
}

// Single source of truth per tier. Non-locale presentation (emoji + the quiet
// accent used on the "Level N" eyebrow) lives here so adding a future fourth
// tier is one entry, not edits scattered across parallel arrays. Copy stays in
// the locale files under chat.rot.levels.levelN. `accent` is resolved against
// the active theme at render time.
type RotLevelConfig = {
  level: number;
  emoji: string;
  accent: (theme: ReturnType<typeof useTheme>) => string;
};

const ROT_LEVELS: readonly RotLevelConfig[] = [
  { level: 1, emoji: "🤓", accent: (t) => t["--color-foreground-secondary"] },
  { level: 2, emoji: "😤", accent: (t) => t["--color-primary"] },
  { level: 3, emoji: "💀", accent: (t) => t["--color-secondary"] },
] as const;

const LEVEL_COUNT = ROT_LEVELS.length;

const TRACK_HEIGHT = 56;
const THUMB_SIZE = 44;
// Inset so the thumb never clips the rail's rounded ends.
const RAIL_INSET = 6;
const DOT_SIZE = 6;
// Fixed height reserved for the copy block. Sized for the longest (Goblin
// Mode) description in either locale so the Done button stays put.
const DETAILS_HEIGHT = 132;

// Snap behavior shared by drag-end, tap, and a11y commits. Spring when motion
// is allowed; the parent passes `reduceMotion` so callers can fall back to a
// hard set.
const SNAP_SPRING = { damping: 18, stiffness: 220, mass: 0.7 } as const;

// progress is 0..1 where 0 = level 1 (left, calm) and 1 = top level (right).
function levelToProgress(level: number): number {
  "worklet";
  const clamped = Math.min(Math.max(level, 1), LEVEL_COUNT);
  return (clamped - 1) / (LEVEL_COUNT - 1);
}
function progressToLevel(progress: number): number {
  "worklet";
  return Math.round(progress * (LEVEL_COUNT - 1)) + 1;
}
function clampLevel(level: number): number {
  return Math.min(Math.max(Math.round(level), 1), LEVEL_COUNT);
}

export const RotLevelSheet = forwardRef<RotLevelSheetRef, RotLevelSheetProps>(
  function RotLevelSheet({ level, onChange }, ref) {
    const { t } = useTranslation();
    const theme = useTheme();
    const { colorScheme } = useColorScheme();
    const gradient = gradients[colorScheme ?? "light"].primary;
    const reduceMotion = useReducedMotion();

    const sheetRef = useRef<BottomSheetModal>(null);
    const snapPoints = useMemo(() => ["46%"], []);

    useImperativeHandle(
      ref,
      () => ({
        present: () => sheetRef.current?.present(),
        dismiss: () => sheetRef.current?.dismiss(),
      }),
      [],
    );

    // Gesture/animation state on the UI runtime.
    const progress = useSharedValue(levelToProgress(level));
    const startProgress = useSharedValue(0);
    const dragging = useSharedValue(0);
    // Measured rail width, written from onLayout. Worklets read it to map
    // pointer movement → progress; 0 until the first layout pass.
    const trackW = useSharedValue(0);
    // Last level the gesture reported to JS, so we only cross the bridge when
    // the discrete level actually changes during a drag.
    const lastReported = useSharedValue(level);

    // The level the copy block is showing. Mirrors `progress` while dragging,
    // then settles on the committed value. `levelRef` is the synchronous
    // source of truth used by a11y actions without a stale closure.
    const [displayLevel, setDisplayLevel] = useState(clampLevel(level));
    // React-side mirror of the measured width, used to lay out the (static)
    // detents. Set once per layout — not per frame.
    const [trackWidth, setTrackWidth] = useState(0);
    const levelRef = useRef(clampLevel(level));

    const goToLevel = useCallback((next: number) => {
      const clamped = clampLevel(next);
      if (levelRef.current === clamped) return;
      levelRef.current = clamped;
      setDisplayLevel(clamped);
    }, []);

    const commit = useCallback(
      (next: number) => {
        const clamped = clampLevel(next);
        goToLevel(clamped);
        onChange(clamped);
      },
      [goToLevel, onChange],
    );

    // Keep the rail in sync when the value changes from outside the gesture
    // (initial mount, a11y actions, parent reset). Hard-set under reduced
    // motion; spring otherwise. Animating to the same spot is a cheap no-op,
    // so this is safe to run on every commit too.
    useEffect(() => {
      const target = levelToProgress(level);
      levelRef.current = clampLevel(level);
      lastReported.value = clampLevel(level);
      setDisplayLevel(clampLevel(level));
      progress.value = reduceMotion
        ? target
        : withSpring(target, SNAP_SPRING);
    }, [level, reduceMotion, lastReported, progress]);

    const onTrackLayout = useCallback(
      (e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        trackW.value = w;
        setTrackWidth(w);
      },
      [trackW],
    );

    const pan = useMemo(
      () =>
        Gesture.Pan()
          .onBegin(() => {
            dragging.value = reduceMotion ? 1 : withTiming(1, { duration: 120 });
            startProgress.value = progress.value;
          })
          .onUpdate((e) => {
            // Right (positive translationX) increases intensity.
            const travel = Math.max(trackW.value - THUMB_SIZE - RAIL_INSET * 2, 1);
            const next = startProgress.value + e.translationX / travel;
            const clamped = next < 0 ? 0 : next > 1 ? 1 : next;
            progress.value = clamped;
            const lvl = progressToLevel(clamped);
            if (lvl !== lastReported.value) {
              lastReported.value = lvl;
              runOnJS(goToLevel)(lvl);
            }
          })
          .onEnd(() => {
            const lvl = progressToLevel(progress.value);
            const target = levelToProgress(lvl);
            progress.value = reduceMotion ? target : withSpring(target, SNAP_SPRING);
            lastReported.value = lvl;
            runOnJS(commit)(lvl);
          })
          .onFinalize(() => {
            dragging.value = reduceMotion ? 0 : withTiming(0, { duration: 200 });
          }),
      [
        commit,
        dragging,
        goToLevel,
        lastReported,
        progress,
        reduceMotion,
        startProgress,
        trackW,
      ],
    );

    const tap = useMemo(
      () =>
        Gesture.Tap()
          .maxDuration(260)
          .onEnd((e) => {
            // Map the tap's X (relative to the rail) to a progress.
            const travel = Math.max(trackW.value - THUMB_SIZE - RAIL_INSET * 2, 1);
            const raw = (e.x - RAIL_INSET - THUMB_SIZE / 2) / travel;
            const clamped = raw < 0 ? 0 : raw > 1 ? 1 : raw;
            const lvl = progressToLevel(clamped);
            const target = levelToProgress(lvl);
            progress.value = reduceMotion ? target : withSpring(target, SNAP_SPRING);
            lastReported.value = lvl;
            runOnJS(commit)(lvl);
          }),
      [commit, lastReported, progress, reduceMotion, trackW],
    );

    const gesture = useMemo(() => Gesture.Race(pan, tap), [pan, tap]);

    // Soft fill grows left→right to the thumb center. Hidden until measured to
    // avoid a first-frame snap from width 0.
    const fillStyle = useAnimatedStyle(() => {
      const travel = Math.max(trackW.value - THUMB_SIZE - RAIL_INSET * 2, 0);
      const center = RAIL_INSET + THUMB_SIZE / 2 + progress.value * travel;
      return {
        width: center,
        opacity: trackW.value > 0 ? 1 : 0,
      };
    });

    // Thumb rides on translateX. It lifts (shadow + a hair of scale) only while
    // touched — and not at all under reduced motion.
    const thumbStyle = useAnimatedStyle(() => {
      const travel = Math.max(trackW.value - THUMB_SIZE - RAIL_INSET * 2, 0);
      const x = RAIL_INSET + progress.value * travel;
      const lift = dragging.value;
      return {
        opacity: trackW.value > 0 ? 1 : 0,
        transform: [
          { translateX: x },
          { scale: reduceMotion ? 1 : 1 + lift * 0.06 },
        ],
        shadowOpacity: 0.06 + lift * 0.12,
        shadowRadius: 4 + lift * 6,
        elevation: 2 + lift * 4,
      };
    });

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

    const active = ROT_LEVELS[displayLevel - 1] ?? ROT_LEVELS[1];
    const levelName = t(`chat.rot.levels.level${displayLevel}.name`);
    const levelDesc = t(`chat.rot.levels.level${displayLevel}.description`);
    const a11yValue = t("chat.rot.a11yValue", {
      level: displayLevel,
      name: levelName,
    });

    // Static detent positions, recomputed only when the measured width changes.
    const travel = Math.max(trackWidth - THUMB_SIZE - RAIL_INSET * 2, 0);

    return (
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose
        // The horizontal drag belongs to the rail; keep the sheet's own content
        // pan off so the two never fight.
        enableContentPanningGesture={false}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme["--color-card"] }}
        handleIndicatorStyle={{ backgroundColor: theme["--color-foreground-muted"] }}
      >
        <BottomSheetView
          style={{ flex: 1, paddingHorizontal: 24, paddingBottom: 20 }}
        >
          {/* Header */}
          <View style={{ gap: 4, paddingTop: 2 }}>
            <Typography
              variant="title-lg"
              style={{ color: theme["--color-foreground"] }}
            >
              {t("chat.rot.title")}
            </Typography>
            <Typography
              variant="caption"
              style={{ color: theme["--color-foreground-muted"] }}
            >
              {t("chat.rot.subtitle")}
            </Typography>
          </View>

          {/* Horizontal rail */}
          <View style={{ marginTop: 26 }}>
            <GestureDetector gesture={gesture}>
              <View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={t("chat.rot.title")}
                accessibilityValue={{ text: a11yValue }}
                accessibilityActions={[
                  { name: "increment" },
                  { name: "decrement" },
                ]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "increment") {
                    commit(levelRef.current + 1);
                  } else if (event.nativeEvent.actionName === "decrement") {
                    commit(levelRef.current - 1);
                  }
                }}
                onLayout={onTrackLayout}
                style={{ height: TRACK_HEIGHT, justifyContent: "center" }}
              >
                {/* Rail background (clips the fill to the pill shape). */}
                <View
                  style={{
                    ...StyleSheet.absoluteFillObject,
                    borderRadius: TRACK_HEIGHT / 2,
                    backgroundColor: theme["--color-background-muted"],
                    borderWidth: 1,
                    borderColor: theme["--color-border"],
                    overflow: "hidden",
                  }}
                >
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      {
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        backgroundColor: theme["--color-primary"],
                      },
                      fillStyle,
                    ]}
                  />
                </View>

                {/* Detents — quiet stops the thumb settles onto. */}
                {trackWidth > 0
                  ? ROT_LEVELS.map((cfg) => {
                      const centerX =
                        RAIL_INSET +
                        THUMB_SIZE / 2 +
                        levelToProgress(cfg.level) * travel;
                      const isActive = cfg.level === displayLevel;
                      return (
                        <View
                          key={cfg.level}
                          pointerEvents="none"
                          style={{
                            position: "absolute",
                            left: centerX - DOT_SIZE / 2,
                            width: DOT_SIZE,
                            height: DOT_SIZE,
                            borderRadius: DOT_SIZE / 2,
                            backgroundColor: isActive
                              ? "rgba(255,255,255,0.9)"
                              : theme["--color-border-strong"],
                            opacity: isActive ? 0.95 : 0.7,
                          }}
                        />
                      );
                    })
                  : null}

                {/* Thumb — emoji marker that lifts only while touched. */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    {
                      position: "absolute",
                      left: 0,
                      width: THUMB_SIZE,
                      height: THUMB_SIZE,
                      borderRadius: THUMB_SIZE / 2,
                      backgroundColor: theme["--color-card"],
                      borderWidth: 1,
                      borderColor: theme["--color-border-strong"],
                      alignItems: "center",
                      justifyContent: "center",
                      shadowColor: "#000000",
                      shadowOffset: { width: 0, height: 2 },
                    },
                    thumbStyle,
                  ]}
                >
                  <Text style={{ fontSize: 20 }}>{active.emoji}</Text>
                </Animated.View>
              </View>
            </GestureDetector>
          </View>

          {/* Copy block — fixed height so Done never jumps. Subtle fade only. */}
          <View style={{ height: DETAILS_HEIGHT, marginTop: 20 }}>
            <Animated.View
              key={displayLevel}
              entering={reduceMotion ? undefined : FadeIn.duration(160)}
              exiting={reduceMotion ? undefined : FadeOut.duration(120)}
              style={{ position: "absolute", left: 0, right: 0, top: 0, gap: 8 }}
            >
              <Typography
                variant="overline"
                style={{ color: active.accent(theme) }}
              >
                {`Level ${displayLevel}`}
              </Typography>
              <Typography
                variant="title-md"
                style={{ color: theme["--color-foreground"] }}
              >
                {levelName}
              </Typography>
              <Typography
                variant="body"
                style={{ color: theme["--color-foreground-secondary"] }}
              >
                {levelDesc}
              </Typography>
            </Animated.View>
          </View>

          {/* Done */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.rot.done")}
            onPress={() => sheetRef.current?.dismiss()}
            style={({ pressed }) => ({
              marginTop: "auto",
              height: 52,
              borderRadius: 26,
              overflow: "hidden",
              opacity: pressed ? 0.92 : 1,
            })}
          >
            <LinearGradient
              colors={gradient.colors}
              start={gradient.start}
              end={gradient.end}
              style={StyleSheet.absoluteFillObject}
            />
            <View
              style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
            >
              <Typography
                variant="title-sm"
                style={{ color: "#FFFFFF", fontWeight: "800" }}
              >
                {t("chat.rot.done")}
              </Typography>
            </View>
          </Pressable>
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);
