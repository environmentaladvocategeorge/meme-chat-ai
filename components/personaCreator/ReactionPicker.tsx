// ReactionPicker
//
// The persona creator's "Reactions" step. Instead of typing GIF references
// (free text we can't moderate), the user browses Klipy — a GIFs / Memes
// segmented control over the shared search-and-grid picker (TrendingMemeStrip)
// — and taps the ones their bot should reach for. Klipy results are already
// content-filtered, so the picker doubles as a moderation gate.
//
// What we keep is just the picked item's NAME (its Klipy title): it becomes a
// `media.pills` entry the decider re-searches at chat time, never the asset
// itself. The thumbnail is cached LOCALLY on the draft (mediaPicks) only so the
// picked tray can render on reload; the form's `mediaPills` mirrors the names.

import { AppPressable } from "@/components/AppPressable";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TrendingMemeStrip } from "@/components/TrendingMemeStrip";
import { Typography } from "@/components/Typography";
import type { TrendingGif } from "@/domain/gifs";
import type { TrendingMeme } from "@/domain/memes";
import type { MediaPick } from "@/domain/personaDrafts";
import { LIMITS, type PersonaFormValues } from "@/domain/personaForm";
import { useKlipy } from "@/hooks/useKlipy";
import { useKlipyGifs } from "@/hooks/useKlipyGifs";
import { useTheme } from "@/hooks/useTheme";
import { useActiveDraft, usePersonaDraftStore } from "@/store/personaDraft";
import { Image as ExpoImage } from "expo-image";
import { X } from "phosphor-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

type Tab = "gifs" | "memes";

export function ReactionPicker() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>("gifs");

  // The form owns the names (→ media.pills); the draft owns name + thumbnail so
  // the tray can render. We write both on every change so they stay in lockstep.
  const { setValue } = useFormContext<PersonaFormValues>();
  const draft = useActiveDraft();
  const picks = draft?.mediaPicks ?? [];

  // Only the visible tab fetches.
  const gifs = useKlipyGifs({ perPage: 24, enabled: tab === "gifs" });
  const memes = useKlipy({ perPage: 24, enabled: tab === "memes" });

  const atCap = picks.length >= LIMITS.mediaPillsMax;

  const commit = useCallback(
    (next: MediaPick[]) => {
      usePersonaDraftStore.getState().updateActive({ mediaPicks: next });
      setValue(
        "mediaPills",
        next.map((p) => p.name),
        { shouldDirty: true, shouldValidate: true },
      );
    },
    [setValue],
  );

  // Legacy/safety: a draft made before this step (or via a template) may carry
  // mediaPills names with no cached thumbnails. Seed the tray from them once so
  // they show as text chips and aren't silently dropped on the next pick.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const active = usePersonaDraftStore.getState();
    const current = active.drafts.find((d) => d.id === active.activeId);
    if (!current) return;
    const names = current.values.mediaPills ?? [];
    if (current.mediaPicks.length === 0 && names.length > 0) {
      active.updateActive({
        mediaPicks: names.map((name) => ({ name, previewUrl: "" })),
      });
    }
  }, []);

  const handleSelect = useCallback(
    (item: TrendingGif | TrendingMeme) => {
      const name = (item.title?.trim() || item.slug?.trim() || "").slice(
        0,
        LIMITS.mediaPill,
      );
      if (!name) return;
      const current = usePersonaDraftStore.getState();
      const list =
        current.drafts.find((d) => d.id === current.activeId)?.mediaPicks ?? [];
      if (list.length >= LIMITS.mediaPillsMax) return;
      if (list.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
      commit([...list, { name, previewUrl: item.previewUrl }]);
    },
    [commit],
  );

  const handleRemove = useCallback(
    (name: string) => {
      commit(picks.filter((p) => p.name !== name));
    },
    [commit, picks],
  );

  const labels = {
    searchPlaceholder:
      tab === "gifs"
        ? t("chat.gifs.searchPlaceholder")
        : t("chat.memes.searchPlaceholder"),
    empty: tab === "gifs" ? t("chat.gifs.empty") : t("chat.memes.empty"),
    noResults:
      tab === "gifs" ? t("chat.gifs.noResults") : t("chat.memes.noResults"),
    error: tab === "gifs" ? t("chat.gifs.error") : t("chat.memes.error"),
    retry: tab === "gifs" ? t("chat.gifs.retry") : t("chat.memes.retry"),
  };

  return (
    <View style={{ gap: 14 }}>
      <SegmentedControl<Tab>
        options={[
          { value: "gifs", label: t("personasCreator.reactions.gifs") },
          { value: "memes", label: t("personasCreator.reactions.memes") },
        ]}
        value={tab}
        onChange={setTab}
      />

      {/* Picked tray — thumbnails (or text chips when no cached preview), each
          with a remove badge. Shows the running count against the cap. */}
      {picks.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Typography
            variant="overline"
            style={{ color: theme["--color-foreground-muted"] }}
          >
            {t("personasCreator.reactions.picked", {
              count: picks.length,
              max: LIMITS.mediaPillsMax,
            })}
          </Typography>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {picks.map((pick) => (
              <PickedTile
                key={pick.name}
                pick={pick}
                onRemove={() => handleRemove(pick.name)}
                removeLabel={t("personasCreator.reactions.remove", {
                  name: pick.name,
                })}
              />
            ))}
          </View>
        </View>
      ) : null}

      {atCap ? (
        <Typography
          variant="caption"
          style={{ color: theme["--color-foreground-muted"] }}
        >
          {t("personasCreator.reactions.atCap", { max: LIMITS.mediaPillsMax })}
        </Typography>
      ) : (
        <View style={{ opacity: 1 }}>
          {tab === "gifs" ? (
            <TrendingMemeStrip
              items={gifs.gifs}
              loading={gifs.loading}
              loadingMore={gifs.loadingMore}
              error={gifs.error}
              hasNext={gifs.hasNext}
              mode={gifs.mode}
              searching={gifs.searching}
              query={gifs.query}
              onChangeQuery={gifs.setQuery}
              onClearSearch={gifs.clearSearch}
              onEndReached={gifs.loadMore}
              onRetry={gifs.retry}
              onSelectItem={handleSelect}
              animated
              labels={labels}
            />
          ) : (
            <TrendingMemeStrip
              items={memes.memes}
              loading={memes.loading}
              loadingMore={memes.loadingMore}
              error={memes.error}
              hasNext={memes.hasNext}
              mode={memes.mode}
              searching={memes.searching}
              query={memes.query}
              onChangeQuery={memes.setQuery}
              onClearSearch={memes.clearSearch}
              onEndReached={memes.loadMore}
              onRetry={memes.retry}
              onSelectItem={handleSelect}
              labels={labels}
            />
          )}
        </View>
      )}
    </View>
  );
}

const TILE_SIZE = 64;

function PickedTile({
  pick,
  onRemove,
  removeLabel,
}: {
  pick: MediaPick;
  onRemove: () => void;
  removeLabel: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: TILE_SIZE,
        height: TILE_SIZE,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: theme["--color-card-muted"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
      }}
    >
      {pick.previewUrl ? (
        <ExpoImage
          source={{ uri: pick.previewUrl }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
        />
      ) : (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
          }}
        >
          <Typography
            variant="caption"
            numberOfLines={2}
            style={{
              color: theme["--color-foreground-secondary"],
              textAlign: "center",
            }}
          >
            {pick.name}
          </Typography>
        </View>
      )}
      <AppPressable
        onPress={onRemove}
        haptic
        hitSlop={8}
        accessibilityLabel={removeLabel}
        containerStyle={{ position: "absolute", top: 2, right: 2 }}
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme["--color-overlay"],
        }}
      >
        <X size={12} weight="bold" color="#FFFFFF" />
      </AppPressable>
    </View>
  );
}
