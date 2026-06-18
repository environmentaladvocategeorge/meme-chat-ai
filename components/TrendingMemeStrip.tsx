// TrendingMemeStrip
//
// A KLIPY meme picker: a "Search KLIPY" box on top and a left-to-right
// scrollable row of memes below. Largely presentational + modular — hand it
// the output of `useKlipy` (memes, loading, error, query, etc.) and it renders
// the whole thing with shimmer-loading, error, and empty states.
//
// KLIPY attribution (per their API guidelines):
//   - "Search KLIPY" placeholder in the search field (REQUIRED).
//   - KLIPY watermark on each meme (STRONGLY RECOMMENDED).
// The optional "Powered by KLIPY" mark is intentionally omitted — the required
// placeholder + per-meme watermark already satisfy the guidelines.

import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { Typography } from "@/components/Typography";
import { stripCardWidth } from "@/domain/mediaLayout";
import { useTheme } from "@/hooks/useTheme";
import { LinearGradient } from "expo-linear-gradient";
import { Image as ExpoImage } from "expo-image";
import { useColorScheme } from "nativewind";
import { ArrowClockwise, Gif, MagnifyingGlass, X } from "phosphor-react-native";
import { useEffect, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const STRIP_HEIGHT = 120;
const CARD_GAP = 8;
const MIN_CARD_WIDTH = 80;
const MAX_CARD_WIDTH = 200;
// 376×103 source wordmark.
const KLIPY_LOGO = require("../assets/images/klipy-logo-light.png");
const KLIPY_LOGO_RATIO = 376 / 103;

type MemeStripLabels = {
  searchPlaceholder: string; // "Search KLIPY"
  empty: string;
  noResults: string;
  error: string;
  retry: string;
};

// Minimal shape the strip needs to render a card. Both TrendingMeme and
// TrendingGif satisfy it, so the strip powers memes and GIFs alike.
export type StripMedia = {
  id: string;
  slug: string;
  title: string;
  url: string;
  width: number;
  height: number;
  blurPreview: string | null;
};

type TrendingMemeStripProps<T extends StripMedia> = {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasNext: boolean;
  mode: "trending" | "search";
  searching: boolean;
  query: string;
  onChangeQuery: (q: string) => void;
  onClearSearch: () => void;
  onEndReached?: () => void;
  onRetry?: () => void;
  onSelectItem?: (item: T) => void;
  // When true, cards render the animated asset (GIFs) via expo-image instead of
  // a static still.
  animated?: boolean;
  // Horizontal padding of the parent container. The scrolling row breaks out of
  // it with a negative margin and re-adds it as leading/trailing content padding
  // — so the first card lines up with the search box at rest, but cards scroll
  // edge-to-edge off the screen instead of being clipped at the parent's inset.
  bleed?: number;
  labels: MemeStripLabels;
};

// Scale each item to the fixed strip height, preserving aspect ratio, clamped
// to sane bounds so a freak-shaped item can't blow out the row.
function cardWidth(item: StripMedia): number {
  return stripCardWidth(item, {
    height: STRIP_HEIGHT,
    min: MIN_CARD_WIDTH,
    max: MAX_CARD_WIDTH,
  });
}

// One shimmering placeholder card. A light band sweeps across a muted surface
// on a loop; `delay` offsets each card's phase so the row reads as a wave.
function SkeletonCard({ width, delay }: { width: number; delay: number }) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const highlight =
    colorScheme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.6)";
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        -1,
        false,
      ),
    );
  }, [shimmer, delay]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(shimmer.value, [0, 1], [-width, width]) },
    ],
  }));

  return (
    <View
      style={{
        width,
        height: STRIP_HEIGHT,
        borderRadius: 14,
        overflow: "hidden",
        backgroundColor: theme["--color-card-muted"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
      }}
    >
      <Animated.View style={[{ width, height: "100%" }, sweepStyle]}>
        <LinearGradient
          colors={["transparent", highlight, "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

// Varied widths so the loading state mimics the natural rhythm of real memes.
const SKELETON_WIDTHS = [150, 110, 175, 120, 160, 100];

function SkeletonRow() {
  return (
    <View
      style={{
        height: STRIP_HEIGHT,
        flexDirection: "row",
        gap: CARD_GAP,
        paddingHorizontal: 2,
        overflow: "hidden",
      }}
    >
      {SKELETON_WIDTHS.map((w, i) => (
        <SkeletonCard key={i} width={w} delay={i * 110} />
      ))}
    </View>
  );
}

// The required KLIPY watermark, sat in the bottom-right of a meme over a soft
// gradient scrim so the light wordmark stays legible on any image.
function CardWatermark() {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 30,
        justifyContent: "flex-end",
      }}
    >
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.5)"]}
        style={StyleSheet.absoluteFill}
      />
      <ExpoImage
        source={KLIPY_LOGO}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
        style={{
          alignSelf: "flex-end",
          height: 9,
          width: 9 * KLIPY_LOGO_RATIO,
          margin: 5,
          opacity: 0.95,
        }}
      />
    </View>
  );
}

function MemeCard<T extends StripMedia>({
  meme,
  index,
  animated,
  onSelect,
}: {
  meme: T;
  index: number;
  animated?: boolean;
  onSelect?: (meme: T) => void;
}) {
  const theme = useTheme();
  const width = cardWidth(meme);

  // Staggered entrance: each card fades, rises, and settles with a slight
  // scale, delayed by its position so the row cascades in instead of popping.
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withDelay(
      Math.min(index, 10) * 32,
      withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }),
    );
  }, [enter, index]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * 12 },
      { scale: 0.95 + enter.value * 0.05 },
    ],
  }));

  return (
    <Animated.View style={enterStyle}>
      <AppPressable
        accessibilityRole="imagebutton"
        accessibilityLabel={meme.title || meme.slug || "meme"}
        onPress={onSelect ? () => onSelect(meme) : undefined}
        haptic
        feedback="opacity"
        style={{
          width,
          height: STRIP_HEIGHT,
          borderRadius: 14,
          overflow: "hidden",
          backgroundColor: theme["--color-card-muted"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      >
        {animated ? (
          // GIFs: expo-image plays animated webp/gif and shows the tiny base64
          // placeholder while the CDN asset streams in.
          <ExpoImage
            source={{ uri: meme.url }}
            placeholder={meme.blurPreview ? { uri: meme.blurPreview } : undefined}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={meme.id}
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <ExpoImage
            // blurPreview is a tiny inline base64 placeholder shown while the
            // CDN asset streams in; expo-image blurs-up to the still and caches
            // it to memory+disk so re-scrolling the strip is instant.
            source={{ uri: meme.url }}
            placeholder={
              meme.blurPreview ? { uri: meme.blurPreview } : undefined
            }
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            recyclingKey={meme.id}
            style={{ width: "100%", height: "100%" }}
          />
        )}
        <CardWatermark />
      </AppPressable>
    </Animated.View>
  );
}

function SearchBox({
  value,
  onChangeText,
  onClear,
  placeholder,
  searching,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onClear: () => void;
  placeholder: string;
  searching: boolean;
}) {
  const theme = useTheme();
  return (
    <GlassSurface
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 40,
        paddingHorizontal: 12,
        borderRadius: 999,
        marginBottom: 10,
      }}
      fallbackStyle={{
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
      }}
    >
      <MagnifyingGlass size={18} color={theme["--color-foreground-muted"]} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme["--color-foreground-muted"]}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{
          flex: 1,
          color: theme["--color-foreground"],
          fontFamily: "Poppins-Regular",
          fontSize: 15,
          padding: 0,
        }}
      />
      {/* Live feedback: a spinner the instant the user types, swapped for a
          clear button once the search settles. */}
      {searching ? (
        <ActivityIndicator size="small" color={theme["--color-primary"]} />
      ) : value.length > 0 ? (
        <AppPressable
          accessibilityLabel="clear"
          onPress={onClear}
          feedback="opacity"
          hitSlop={8}
        >
          <X size={16} color={theme["--color-foreground-muted"]} weight="bold" />
        </AppPressable>
      ) : null}
    </GlassSurface>
  );
}

export function TrendingMemeStrip<T extends StripMedia>({
  items,
  loading,
  loadingMore,
  error,
  hasNext,
  mode,
  searching,
  query,
  onChangeQuery,
  onClearSearch,
  onEndReached,
  onRetry,
  onSelectItem,
  animated,
  bleed = 0,
  labels,
}: TrendingMemeStripProps<T>) {
  const theme = useTheme();

  const centered = {
    height: STRIP_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  } as const;

  // The meme row + its various states. The search box wraps it.
  let body: ReactNode;
  if (loading) {
    // Fresh load (initial open or a new query) → shimmer skeletons. This also
    // gives searching a clean "swap" instead of stale results hanging around.
    body = <SkeletonRow />;
  } else if (error && items.length === 0) {
    body = (
      <View style={[centered, { flexDirection: "row", gap: 10 }]}>
        <Typography
          variant="body-sm"
          style={{ color: theme["--color-foreground-muted"] }}
        >
          {labels.error}
        </Typography>
        {onRetry ? (
          <AppPressable
            accessibilityLabel={labels.retry}
            onPress={onRetry}
            feedback="opacity"
            hitSlop={8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: theme["--color-background-secondary"],
            }}
          >
            <ArrowClockwise
              size={14}
              color={theme["--color-primary"]}
              weight="bold"
            />
            <Typography
              variant="caption"
              style={{ color: theme["--color-primary"], fontWeight: "700" }}
            >
              {labels.retry}
            </Typography>
          </AppPressable>
        ) : null}
      </View>
    );
  } else if (items.length === 0) {
    body = (
      <View style={[centered, { flexDirection: "row", gap: 8 }]}>
        <Gif size={18} color={theme["--color-foreground-muted"]} />
        <Typography
          variant="body-sm"
          style={{ color: theme["--color-foreground-muted"] }}
        >
          {mode === "search" ? labels.noResults : labels.empty}
        </Typography>
      </View>
    );
  } else {
    body = (
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Keep mounted cards alive so their entrance doesn't replay on scroll.
        removeClippedSubviews={false}
        // Full-bleed: cancel the parent's padding so the row reaches the screen
        // edges, then re-add it inside so the first/last cards still sit at the
        // resting inset (see `bleed`).
        style={bleed > 0 ? { marginHorizontal: -bleed } : undefined}
        contentContainerStyle={{
          gap: CARD_GAP,
          paddingHorizontal: bleed > 0 ? bleed : 2,
        }}
        renderItem={({ item, index }) => (
          <MemeCard
            meme={item}
            index={index}
            animated={animated}
            onSelect={onSelectItem}
          />
        )}
        onEndReached={hasNext ? onEndReached : undefined}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <View
              style={{
                width: 48,
                height: STRIP_HEIGHT,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ActivityIndicator color={theme["--color-primary"]} />
            </View>
          ) : null
        }
      />
    );
  }

  return (
    <View>
      <SearchBox
        value={query}
        onChangeText={onChangeQuery}
        onClear={onClearSearch}
        placeholder={labels.searchPlaceholder}
        searching={searching}
      />
      {body}
    </View>
  );
}
