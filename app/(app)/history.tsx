import { AdBanner } from "@/components/ads/AdBanner";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AppHeader, useAppHeaderHeight } from "@/components/AppHeader";
import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { IconButton } from "@/components/IconButton";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Typography } from "@/components/Typography";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/domain/customization";
import { deleteConversationsCallable } from "@/services/firebase/callables";
import {
  fetchOlderConversations,
  subscribeToConversations,
  type ConversationCursor,
  type ConversationSummary,
} from "@/services/firebase/conversations";
import { useAuthStore } from "@/store/auth";
import { useChatStore } from "@/store/chat";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Fuse from "fuse.js";
import { useColorScheme } from "nativewind";
import { CheckCircle, MagnifyingGlass, Trash, X } from "phosphor-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

type SortOption = "recent" | "oldest" | "alpha";

const SORT_OPTIONS: readonly { value: SortOption; labelKey: string }[] = [
  { value: "recent", labelKey: "history.sort.recent" },
  { value: "oldest", labelKey: "history.sort.oldest" },
  { value: "alpha", labelKey: "history.sort.alpha" },
] as const;

const DAY = 24 * 60 * 60 * 1000;

type Bucket = "today" | "last3" | "last30" | "older";

const BUCKET_LABEL_KEYS: Record<Bucket, string> = {
  today: "history.sections.today",
  last3: "history.sections.last3",
  last30: "history.sections.last30",
  older: "history.sections.older",
};

// Calendar-aware bucket so "Today" matches the user's expectation regardless
// of how long ago in absolute milliseconds the conversation was updated.
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function bucketFor(updatedAt: Date | null, todayStartMs: number): Bucket {
  if (!updatedAt) return "older";
  const itemStart = startOfDay(updatedAt);
  const diffDays = Math.round((todayStartMs - itemStart) / DAY);
  if (diffDays <= 0) return "today";
  if (diffDays <= 3) return "last3";
  if (diffDays <= 30) return "last30";
  return "older";
}

type HistorySection = {
  key: Bucket | "all";
  title: string | null;
  data: ConversationSummary[];
};

// Edge fades — same dissolve language as the chat thread, so list content
// melts into the backdrop at both edges instead of hard-cutting.
const TOP_FADE_HEIGHT = 20;
const BOTTOM_FADE_HEIGHT = 28;

// Hoisted (stable identity) so the list never re-mounts separators just
// because the screen re-rendered.
function ItemSeparator() {
  return <View style={{ height: 8 }} />;
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const uid = useAuthStore((s) => s.uid);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const activeConversationId = useChatStore((s) => s.conversationId);
  const startNewConversation = useChatStore((s) => s.startNewConversation);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // Conversations paged in past the live window (oldest-first chain of
  // 50-doc pages). Not live — an updated conversation re-enters via the live
  // window and the merge below dedupes it by id.
  const [older, setOlder] = useState<ConversationSummary[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  // Where the next page starts: the last page's tail, or (before any page is
  // fetched) the live window's tail. Refs, not state — paging shouldn't
  // re-render anything until results land.
  const liveCursorRef = useRef<ConversationCursor | null>(null);
  const pagedCursorRef = useRef<ConversationCursor | null>(null);
  const loadingMoreRef = useRef(false);
  // True until the first conversations snapshot lands, so the list shows a
  // skeleton loader instead of the "no chats yet" empty state while the read is
  // still in flight (otherwise a user with history briefly sees "nothing here").
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const [sort, setSort] = useState<SortOption>("recent");
  // Multi-select state. Selection mode is simply "something is selected" — a
  // long-press seeds it, tapping toggles, and clearing the set exits.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selectionMode = selectedIds.size > 0;

  useEffect(() => {
    if (!uid) {
      setConversations([]);
      setOlder([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    // New identity → drop any prior account's list and show the loader until the
    // first snapshot (or a hard error) resolves it.
    setConversations([]);
    setOlder([]);
    setHasMore(false);
    liveCursorRef.current = null;
    pagedCursorRef.current = null;
    setLoading(true);
    return subscribeToConversations(
      uid,
      (next, meta) => {
        setConversations(next);
        liveCursorRef.current = meta.oldestDoc;
        // Until a page has been fetched, "more exists" is the live window's
        // call; afterwards the page chain owns it.
        if (pagedCursorRef.current === null) setHasMore(meta.hasMore);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [uid]);

  // Pull the next page of older conversations when the user nears the end of
  // the list. Skipped while searching: search covers what's loaded, and
  // paging on a short result list would otherwise chain-fetch the entire
  // account history.
  const handleLoadMore = useCallback(async () => {
    if (
      !uid ||
      loadingMoreRef.current ||
      !hasMore ||
      debouncedQuery.trim().length > 0
    ) {
      return;
    }
    const cursor = pagedCursorRef.current ?? liveCursorRef.current;
    if (!cursor) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchOlderConversations(uid, cursor);
      if (page.oldestDoc) pagedCursorRef.current = page.oldestDoc;
      setHasMore(page.hasMore);
      if (page.conversations.length > 0) {
        setOlder((prev) => [...prev, ...page.conversations]);
      }
    } catch (err) {
      console.warn("[history] load more failed:", err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [uid, hasMore, debouncedQuery]);

  // Live window + paged-in history, deduped by id (an updated conversation
  // re-enters through the live window while its stale copy may still sit in
  // a fetched page — the live copy wins).
  const allConversations = useMemo(() => {
    if (older.length === 0) return conversations;
    const liveIds = new Set(conversations.map((c) => c.id));
    return [...conversations, ...older.filter((c) => !liveIds.has(c.id))];
  }, [conversations, older]);

  // Fuse index — rebuild only when the conversation list changes. Weights
  // bias title matches higher than body matches. Note: search covers loaded
  // conversations (live window + any pages scrolled in), not the full
  // server-side history.
  const fuse = useMemo(
    () =>
      new Fuse(allConversations, {
        keys: [
          { name: "title", weight: 2 },
          { name: "lastMessagePreview", weight: 1 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [allConversations],
  );

  const isSearching = debouncedQuery.trim().length > 0;

  // Filter → sort → group. A–Z and searching produce a single un-headered
  // section because date buckets don't make sense in those modes.
  const sections = useMemo<HistorySection[]>(() => {
    const q = debouncedQuery.trim();
    const filtered =
      q.length === 0
        ? allConversations.slice()
        : fuse.search(q).map((r) => r.item);

    switch (sort) {
      case "recent":
        filtered.sort(
          (a, b) =>
            (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
        );
        break;
      case "oldest":
        filtered.sort(
          (a, b) =>
            (a.updatedAt?.getTime() ?? 0) - (b.updatedAt?.getTime() ?? 0),
        );
        break;
      case "alpha":
        filtered.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        break;
    }

    if (sort === "alpha" || isSearching) {
      return [{ key: "all", title: null, data: filtered }];
    }

    const todayStartMs = startOfDay(new Date());
    const buckets: Record<Bucket, ConversationSummary[]> = {
      today: [],
      last3: [],
      last30: [],
      older: [],
    };
    for (const c of filtered) {
      buckets[bucketFor(c.updatedAt, todayStartMs)].push(c);
    }

    const order: Bucket[] = ["today", "last3", "last30", "older"];
    const next = order
      .filter((b) => buckets[b].length > 0)
      .map<HistorySection>((b) => ({
        key: b,
        title: t(BUCKET_LABEL_KEYS[b]),
        data: buckets[b],
      }));

    return sort === "oldest" ? next.reverse() : next;
  }, [allConversations, debouncedQuery, fuse, isSearching, sort, t]);

  // Soft settle when the list re-arranges (search typed/cleared, sort
  // switched): dip the list's opacity and ease it back, so the new order
  // fades in instead of teleporting. Deliberately opacity-ONLY and on a
  // wrapper around the whole list — animating row positions (layout
  // animations / transforms on the cards) would desync their native
  // hit-test frames on Fabric release builds, the "spam-tap" bug class.
  const resortProgress = useSharedValue(1);
  const resortMountedRef = useRef(false);
  useEffect(() => {
    if (!resortMountedRef.current) {
      resortMountedRef.current = true;
      return;
    }
    resortProgress.value = 0.25;
    resortProgress.value = withTiming(1, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
  }, [debouncedQuery, sort, resortProgress]);
  const resortStyle = useAnimatedStyle(() => ({
    opacity: resortProgress.value,
  }));

  // Stable (useCallback) so the memoized HistoryCard rows don't all re-render
  // on every selection tap — at hundreds of conversations that re-render is
  // the difference between a snappy and a sticky checkbox.
  const openConversation = useCallback(
    (c: ConversationSummary) => {
      loadConversation(c.id);
      router.push({ pathname: "/chat", params: { conversationId: c.id } });
    },
    [loadConversation, router],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCardPress = useCallback(
    (c: ConversationSummary) => {
      if (selectionMode) toggleSelect(c.id);
      else openConversation(c);
    },
    [selectionMode, toggleSelect, openConversation],
  );

  const handleCardLongPress = useCallback(
    (c: ConversationSummary) => {
      toggleSelect(c.id);
    },
    [toggleSelect],
  );

  const clearSelection = () => setSelectedIds(new Set());

  const handleDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      await deleteConversationsCallable(ids);
      // The live snapshot drops deleted docs on its own; the paged cache is
      // not live, so evict them by hand.
      const deleted = new Set(ids);
      setOlder((prev) => prev.filter((c) => !deleted.has(c.id)));
      // If the open chat was among the deleted, reset it so we don't leave a
      // dangling conversation loaded.
      if (activeConversationId && ids.includes(activeConversationId)) {
        startNewConversation();
      }
      clearSelection();
      setConfirmOpen(false);
    } catch (err) {
      console.warn("[history] delete failed:", err);
    } finally {
      setDeleting(false);
    }
  };

  const headerHeight = useAppHeaderHeight();

  // Search + sort + ad scroll under the floating header as the list's header.
  const listHeader = (
    <View style={{ gap: 10, paddingBottom: 10 }}>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={t("history.search.placeholder")}
        clearLabel={t("history.search.clear")}
      />

      <SegmentedControl
        options={SORT_OPTIONS.map((o) => ({
          value: o.value,
          label: t(o.labelKey),
        }))}
        value={sort}
        onChange={setSort}
      />

      {/* Free-tier ad banner — hidden for Pro (any paid plan). */}
      <AdBanner />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      {/* relative wrapper hosts the edge fades over the scroll area; the
          inner animated wrapper carries the re-sort settle fade (kept off
          the edge fades so they don't flicker with it). */}
      <View style={{ flex: 1 }}>
        <Animated.View style={[{ flex: 1 }, resortStyle]}>
        <SectionList<ConversationSummary, HistorySection>
          sections={sections}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 18,
            paddingTop: headerHeight + 8,
            paddingBottom: 28,
          }}
          scrollIndicatorInsets={{ top: headerHeight }}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          // Virtualization tuning mirrors the chat thread's: render enough to
          // cover fast flicks, keep per-frame batches small so hundreds of
          // cards never mount at once.
          windowSize={7}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          updateCellsBatchingPeriod={50}
          onEndReached={() => void handleLoadMore()}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 14 }}>
                <ActivityIndicator
                  size="small"
                  color={theme["--color-foreground-muted"]}
                />
              </View>
            ) : null
          }
          ListEmptyComponent={
            loading ? (
              <HistoryLoadingState label={t("history.loading")} />
            ) : isSearching ? (
              <NoSearchResults query={debouncedQuery} />
            ) : (
              <EmptyState />
            )
          }
          renderSectionHeader={({ section }) =>
            section.title ? (
              <SectionHeader title={section.title} count={section.data.length} />
            ) : null
          }
          renderItem={({ item }) => (
            <HistoryCard
              conversation={item}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              onPress={handleCardPress}
              onLongPress={handleCardLongPress}
            />
          )}
          ItemSeparatorComponent={ItemSeparator}
        />
        </Animated.View>
        {/* Edge fades: cards dissolve into the backdrop instead of slicing
            off at the scroll bounds — same language as the chat thread. */}
        <LinearGradient
          pointerEvents="none"
          colors={[
            theme["--color-background"],
            withAlpha(theme["--color-background"], 0),
          ]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: TOP_FADE_HEIGHT,
          }}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[
            withAlpha(theme["--color-background"], 0),
            theme["--color-background"],
          ]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: BOTTOM_FADE_HEIGHT,
          }}
        />
      </View>

      {selectionMode ? (
        <AppHeader
          title={t("history.select.count", { count: selectedIds.size })}
          onBack={clearSelection}
          backAccessibilityLabel={t("common.cancel")}
          right={
            <Animated.View entering={FadeIn.duration(180)}>
              <IconButton
                accessibilityLabel={t("history.select.confirm")}
                onPress={() => setConfirmOpen(true)}
                hitSlop={8}
                size={40}
                surfaceStyle={{ backgroundColor: theme["--color-error-muted"] }}
              >
                <Trash size={22} color={theme["--color-error"]} weight="bold" />
              </IconButton>
            </Animated.View>
          }
        />
      ) : (
        <AppHeader title={t("history.title")} />
      )}

      <DeleteConfirmModal
        visible={confirmOpen}
        count={selectedIds.size}
        deleting={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </View>
  );
}

// ----- DeleteConfirmModal -----
//
// Small on-theme confirmation. Deletion is irreversible, so we say so plainly
// and make "Delete" the visually loud (error-tinted) action.

function DeleteConfirmModal({
  visible,
  count,
  deleting,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  count: number;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const title =
    count === 1
      ? t("history.select.deleteOne")
      : t("history.select.deleteMany", { count });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
      >
        <View
          style={{
            backgroundColor: theme["--color-card"],
            borderRadius: 20,
            padding: 22,
            gap: 10,
          }}
        >
          <Typography
            variant="title-md"
            style={{ color: theme["--color-foreground"], fontWeight: "800" }}
          >
            {title}
          </Typography>
          <Typography
            variant="body"
            style={{ color: theme["--color-foreground-secondary"] }}
          >
            {t("history.select.warning")}
          </Typography>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              gap: 12,
              marginTop: 8,
            }}
          >
            <AppPressable
              onPress={onCancel}
              disabled={deleting}
              feedback="opacity"
              accessibilityLabel={t("history.select.cancel")}
              style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 }}
            >
              <Typography
                variant="body"
                style={{
                  color: theme["--color-foreground-muted"],
                  fontWeight: "600",
                }}
              >
                {t("history.select.cancel")}
              </Typography>
            </AppPressable>
            <AppPressable
              accessibilityState={{ busy: deleting }}
              accessibilityLabel={t("history.select.confirm")}
              onPress={onConfirm}
              disabled={deleting}
              haptic
              feedback="opacity"
              style={{
                minWidth: 96,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: theme["--color-error"],
                opacity: deleting ? 0.85 : 1,
              }}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Typography
                  variant="body"
                  style={{ color: "#FFFFFF", fontWeight: "800" }}
                >
                  {t("history.select.confirm")}
                </Typography>
              )}
            </AppPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ----- SectionHeader -----
//
// Carries information (which time bucket + how many chats in it). Stays
// visually quiet — small caps + muted color — so it groups without
// competing with the chat titles for attention.

function SectionHeader({ title, count }: { title: string; count: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        gap: 8,
        paddingTop: 18,
        paddingBottom: 8,
      }}
    >
      <Typography
        variant="caption"
        style={{
          color: theme["--color-foreground-secondary"],
          fontWeight: "800",
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        {title}
      </Typography>
      <Typography
        variant="caption"
        style={{ color: theme["--color-foreground-muted"] }}
      >
        {count}
      </Typography>
    </View>
  );
}

// ----- SearchField -----

function SearchField({
  value,
  onChange,
  placeholder,
  clearLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  clearLabel: string;
}) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);

  return (
    <GlassSurface
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: 46,
        paddingHorizontal: 14,
        borderRadius: 16,
      }}
      fallbackStyle={{
        borderWidth: 1,
        borderColor: theme["--color-border"],
        backgroundColor: theme["--color-input"],
      }}
    >
      <MagnifyingGlass
        size={18}
        color={theme["--color-foreground-muted"]}
        weight="bold"
      />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme["--color-foreground-muted"]}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        style={{
          flex: 1,
          color: theme["--color-foreground"],
          fontFamily: "Poppins-Regular",
          fontSize: 14,
          paddingVertical: 0,
        }}
      />
      {value.length > 0 ? (
        <AppPressable
          accessibilityLabel={clearLabel}
          onPress={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          hitSlop={8}
          pressScale={0.12}
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme["--color-card-muted"],
          }}
        >
          <X size={12} color={theme["--color-foreground-muted"]} weight="bold" />
        </AppPressable>
      ) : null}
    </GlassSurface>
  );
}

// ----- HistoryCard -----
//
// Clean card with no decorative elements — the information is the title,
// the preview, and when it was last updated. Press feedback is the only
// added interaction, because tap-to-open is genuinely useful signal.

// Memoized: with stable handlers from the screen, a selection tap re-renders
// only the toggled card (its `selected` prop changed) instead of every
// visible row — and at hundreds of conversations, "every row" adds up.
const HistoryCard = memo(function HistoryCard({
  conversation,
  selectionMode,
  selected,
  onPress,
  onLongPress,
}: {
  conversation: ConversationSummary;
  selectionMode: boolean;
  selected: boolean;
  onPress: (c: ConversationSummary) => void;
  onLongPress: (c: ConversationSummary) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const relative = useRelativeTime(conversation.updatedAt);

  // Press-scale now lives on AppPressable's inner pointerEvents="none" surface
  // (the proven pattern) rather than a scaling Animated.View ancestor wrapping
  // the touch target.
  return (
      <AppPressable
        accessibilityState={{ selected: selectionMode ? selected : undefined }}
        accessibilityLabel={conversation.title || t("history.untitled")}
        onPress={() => onPress(conversation)}
        onLongPress={() => onLongPress(conversation)}
        delayLongPress={260}
        pressScale={0.03}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 12,
          overflow: "hidden",
        }}
      >
        {/* Liquid Glass surface where supported; the previous solid card +
            border is the non-glass fallback. Selection tints the glass (and
            swaps the fallback to the primary-subtle treatment). */}
        <GlassSurface
          pointerEvents="none"
          tintColor={selected ? theme["--color-primary-subtle"] : undefined}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 14 }]}
          fallbackStyle={{
            backgroundColor: selected
              ? theme["--color-primary-subtle"]
              : theme["--color-card"],
            borderWidth: 1,
            borderColor: selected
              ? theme["--color-primary"]
              : theme["--color-border"],
          }}
        />
        {selectionMode ? (
          // Fade the indicator in/out so entering/leaving selection mode reads
          // as a gentle change rather than a snap.
          <Animated.View
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(140)}
          >
            {selected ? (
              <CheckCircle
                size={24}
                color={theme["--color-primary"]}
                weight="fill"
              />
            ) : (
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 2,
                  borderColor: theme["--color-foreground-muted"],
                }}
              />
            )}
          </Animated.View>
        ) : null}
        {/* layout transition lets the title slide over as the indicator's
            space appears/disappears, instead of jumping. */}
        <Animated.View
          layout={LinearTransition.duration(200)}
          style={{ flex: 1, gap: 6 }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              gap: 10,
            }}
          >
            <Typography
              variant="title-sm"
              numberOfLines={1}
              style={{ color: theme["--color-foreground"], flex: 1 }}
            >
              {conversation.title || t("history.untitled")}
            </Typography>
            {relative ? (
              <Typography
                variant="caption"
                style={{
                  color: theme["--color-foreground-muted"],
                  fontWeight: "600",
                }}
                numberOfLines={1}
              >
                {relative}
              </Typography>
            ) : null}
          </View>
          {conversation.lastMessagePreview.length > 0 ? (
            <Typography
              variant="caption"
              numberOfLines={2}
              style={{ color: theme["--color-foreground-secondary"] }}
            >
              {conversation.lastMessagePreview}
            </Typography>
          ) : null}
        </Animated.View>
      </AppPressable>
  );
});

// ----- HistoryLoadingState -----
//
// Shown while the first conversations snapshot is still in flight, so a user
// with real history never sees the "nothing here yet" empty state by mistake.
// Mirrors the shimmer-skeleton language already used in TrendingMemeStrip: a
// light band sweeps across muted placeholder bars laid out like real cards.

// One muted bar with a light sweep looping across it. `delay` offsets each
// bar's phase so a stack of them reads as a gentle wave rather than a flash.
function ShimmerBar({
  width,
  height,
  delay,
  radius = 6,
}: {
  width: number;
  height: number;
  delay: number;
  radius?: number;
}) {
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
        height,
        borderRadius: radius,
        overflow: "hidden",
        backgroundColor: theme["--color-card-muted"],
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

// A placeholder shaped like a real HistoryCard (same surface, border, padding):
// a title bar over two shorter preview bars.
function HistorySkeletonCard({
  delay,
  titleWidth,
  previewWidth,
}: {
  delay: number;
  titleWidth: number;
  previewWidth: number;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        borderRadius: 14,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
        paddingHorizontal: 14,
        paddingVertical: 14,
        gap: 10,
      }}
    >
      <ShimmerBar width={titleWidth} height={14} delay={delay} radius={7} />
      <ShimmerBar width={previewWidth} height={10} delay={delay + 80} radius={5} />
      <ShimmerBar
        width={previewWidth * 0.6}
        height={10}
        delay={delay + 160}
        radius={5}
      />
    </View>
  );
}

// Varied bar widths so the loading stack mimics the natural rhythm of real
// chat titles/previews rather than a uniform grid.
const SKELETON_ROWS: readonly { titleWidth: number; previewWidth: number }[] = [
  { titleWidth: 172, previewWidth: 244 },
  { titleWidth: 128, previewWidth: 200 },
  { titleWidth: 196, previewWidth: 256 },
  { titleWidth: 112, previewWidth: 176 },
  { titleWidth: 160, previewWidth: 228 },
  { titleWidth: 140, previewWidth: 208 },
];

function HistoryLoadingState({ label }: { label: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ gap: 8 }}
    >
      {SKELETON_ROWS.map((row, i) => (
        <HistorySkeletonCard
          key={i}
          delay={i * 120}
          titleWidth={row.titleWidth}
          previewWidth={row.previewWidth}
        />
      ))}
    </View>
  );
}

// ----- EmptyState -----
//
// Carries information: there's nothing here yet AND here's what to do next.
// The pulsing avatar provides identity (this is Brainrot Bot's screen) which is a
// real signal in a new app where the user may not recognize the mascot yet.

function EmptyState() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        paddingHorizontal: 24,
      }}
    >
      <AgentAvatar size={64} pulse />
      <Typography
        variant="title-sm"
        style={{
          color: theme["--color-foreground"],
          textAlign: "center",
          fontWeight: "800",
        }}
      >
        {t("history.emptyTitle")}
      </Typography>
      <Typography
        variant="body-sm"
        style={{
          color: theme["--color-foreground-secondary"],
          textAlign: "center",
        }}
      >
        {t("history.empty")}
      </Typography>
    </View>
  );
}

// ----- NoSearchResults -----
//
// Echoes the failed query back so the user can see what they searched for
// and notice typos. The hint suggests a recovery action.

function NoSearchResults({ query }: { query: string }) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: 24,
      }}
    >
      <Typography
        variant="title-sm"
        style={{
          color: theme["--color-foreground"],
          textAlign: "center",
          fontWeight: "700",
        }}
      >
        {t("history.search.noResults", { query })}
      </Typography>
      <Typography
        variant="caption"
        style={{
          color: theme["--color-foreground-secondary"],
          textAlign: "center",
        }}
      >
        {t("history.search.noResultsHint")}
      </Typography>
    </View>
  );
}
