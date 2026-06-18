// Reusable inputs for the persona creator: chip lists, type-to-pill, curated
// multi-select pills, an emoji palette picker, and the avatar upload tile.
// Presentational only — they take a value + onChange and lean on the pure
// tag helpers (domain/tagInput) for add/dedupe/cap rules.

import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import { addTag, removeTag, toggleTag } from "@/domain/tagInput";
import { useTheme } from "@/hooks/useTheme";
import { Image } from "expo-image";
import { Camera, Plus, Trash, X, type IconProps } from "phosphor-react-native";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, View } from "react-native";

// A persistent hint under a free-type field so it's obvious that typed text
// only commits on Return (the most common confusion: people type and tap Next,
// losing what they typed). Shown beneath every add-your-own / chip input.
function EnterHint() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 2 }}>
      <Plus size={13} weight="bold" color={theme["--color-foreground-muted"]} />
      <Typography variant="caption" style={{ color: theme["--color-foreground-muted"] }}>
        {t("personasCreator.enterHint")}
      </Typography>
    </View>
  );
}

function Chip({
  label,
  onRemove,
  removeA11y,
}: {
  label: string;
  onRemove: () => void;
  removeA11y: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 12,
        paddingRight: 6,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: theme["--color-card-muted"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
      }}
    >
      <Typography variant="caption" style={{ color: theme["--color-foreground"] }}>
        {label}
      </Typography>
      <AppPressable onPress={onRemove} accessibilityLabel={removeA11y} pressScale={0.1} hitSlop={6}>
        <X size={13} weight="bold" color={theme["--color-foreground-muted"]} />
      </AppPressable>
    </View>
  );
}

function ChipWrap({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

// Type a phrase, submit, it becomes a chip. Backed by the glass Input.
export function TypeToPill({
  value,
  onChange,
  max,
  maxLength,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  maxLength: number;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const atCap = value.length >= max;

  const commit = () => {
    const next = addTag(value, text, max);
    onChange(next);
    setText("");
  };

  return (
    <View style={{ gap: 10 }}>
      {value.length > 0 ? (
        <ChipWrap>
          {value.map((item) => (
            <Chip
              key={item}
              label={item}
              onRemove={() => onChange(removeTag(value, item))}
              removeA11y={t("personasCreator.removeTag", { tag: item })}
            />
          ))}
        </ChipWrap>
      ) : null}
      {!atCap ? (
        <View style={{ gap: 6 }}>
          <Input
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            maxLength={maxLength}
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={commit}
          />
          <EnterHint />
        </View>
      ) : null}
    </View>
  );
}

// Curated chips you toggle on/off, plus an optional "add your own" field.
// `horizontal` lays the preset chips out in a single left/right scrolling row
// (used for the recommendation pills) instead of wrapping onto multiple lines.
export function MultiSelectPills({
  value,
  onChange,
  options,
  max,
  maxLength,
  allowCustom = false,
  customPlaceholder,
  horizontal = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: readonly string[];
  max: number;
  maxLength: number;
  allowCustom?: boolean;
  customPlaceholder?: string;
  horizontal?: boolean;
}) {
  const theme = useTheme();
  const [text, setText] = useState("");

  // Show curated options plus any custom values the user already added.
  const extras = value.filter((v) => !options.some((o) => o.toLowerCase() === v.toLowerCase()));
  const all = [...options, ...extras];

  const commitCustom = () => {
    onChange(addTag(value, text, max));
    setText("");
  };

  const pills = all.map((option) => {
    const selected = value.some((v) => v.toLowerCase() === option.toLowerCase());
    return (
      <AppPressable
        key={option}
        onPress={() => onChange(toggleTag(value, option, max))}
        accessibilityLabel={option}
        accessibilityState={{ selected }}
        pressScale={0.04}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 9,
          borderRadius: 999,
          backgroundColor: selected ? theme["--color-primary-muted"] : theme["--color-card"],
          borderWidth: 1,
          borderColor: selected ? theme["--color-primary"] : theme["--color-border"],
        }}
      >
        <Typography
          variant="caption"
          weight={selected ? "semibold" : "regular"}
          style={{ color: theme["--color-foreground"] }}
        >
          {option}
        </Typography>
      </AppPressable>
    );
  });

  return (
    <View style={{ gap: 10 }}>
      {horizontal ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexDirection: "row", gap: 8, paddingRight: 4 }}
        >
          {pills}
        </ScrollView>
      ) : (
        <ChipWrap>{pills}</ChipWrap>
      )}
      {allowCustom && value.length < max ? (
        <View style={{ gap: 6 }}>
          <Input
            value={text}
            onChangeText={setText}
            placeholder={customPlaceholder}
            maxLength={maxLength}
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={commitCustom}
          />
          <EnterHint />
        </View>
      ) : null}
    </View>
  );
}


// A dashed "add another" affordance shared by the list inputs below.
function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      accessibilityLabel={label}
      pressScale={0.03}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 11,
        borderRadius: 14,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: theme["--color-border-strong"],
        backgroundColor: theme["--color-card"],
      }}
    >
      <Plus size={15} weight="bold" color={theme["--color-foreground"]} />
      <Typography variant="caption" weight="semibold" style={{ color: theme["--color-foreground"] }}>
        {label}
      </Typography>
    </AppPressable>
  );
}

// A small "remove this row" affordance used under list items.
function RemoveRow({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      accessibilityLabel={t("common.remove")}
      pressScale={0.05}
      hitSlop={6}
      style={{ alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2 }}
    >
      <X size={12} weight="bold" color={theme["--color-foreground-muted"]} />
      <Typography variant="caption" style={{ color: theme["--color-foreground-muted"] }}>
        {t("common.remove")}
      </Typography>
    </AppPressable>
  );
}

// A vertical list of multiline text rows (used for greetings): always shows at
// least one input, with "add another" to append and per-row remove once there's
// more than one. Empty rows are harmless; they're filtered out at save time.
export function MultilineListInput({
  value,
  onChange,
  max,
  maxLength,
  placeholder,
  rows = 3,
  addLabel,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  maxLength: number;
  placeholder?: string;
  rows?: number;
  addLabel: string;
}) {
  const display = value.length > 0 ? value : [""];
  return (
    <View style={{ gap: 10 }}>
      {display.map((item, i) => (
        <View key={i} style={{ gap: 4 }}>
          <Input
            value={item}
            onChangeText={(text) => onChange(display.map((v, idx) => (idx === i ? text : v)))}
            placeholder={placeholder}
            maxLength={maxLength}
            multiline
            rows={rows}
          />
          {display.length > 1 ? (
            <RemoveRow onPress={() => onChange(display.filter((_, idx) => idx !== i))} />
          ) : null}
        </View>
      ))}
      {display.length < max ? (
        <AddButton label={addLabel} onPress={() => onChange([...display, ""])} />
      ) : null}
    </View>
  );
}

// Up to `max` voice-example pairs: a "someone says" input on the left and the
// bot's reply on the right, with an Add button that appends a fresh pair. When
// empty it shows just the Add button (the whole field is optional).
export function VoiceExamplesField({
  value,
  onChange,
  max,
  userMax,
  goodMax,
  userPlaceholder,
  goodPlaceholder,
  addLabel,
}: {
  value: { user: string; good: string }[];
  onChange: (next: { user: string; good: string }[]) => void;
  max: number;
  userMax: number;
  goodMax: number;
  userPlaceholder?: string;
  goodPlaceholder?: string;
  addLabel: string;
}) {
  const patchAt = (i: number, patch: Partial<{ user: string; good: string }>) =>
    onChange(value.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  return (
    <View style={{ gap: 12 }}>
      {value.map((pair, i) => (
        <View key={i} style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Input
                value={pair.user}
                onChangeText={(text) => patchAt(i, { user: text })}
                placeholder={userPlaceholder}
                maxLength={userMax}
                multiline
                rows={2}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                value={pair.good}
                onChangeText={(text) => patchAt(i, { good: text })}
                placeholder={goodPlaceholder}
                maxLength={goodMax}
                multiline
                rows={2}
              />
            </View>
          </View>
          <RemoveRow onPress={() => onChange(value.filter((_, idx) => idx !== i))} />
        </View>
      ))}
      {value.length < max ? (
        <AddButton label={addLabel} onPress={() => onChange([...value, { user: "", good: "" }])} />
      ) : null}
    </View>
  );
}

const AVATAR_TILE_SIZE = 116;
const AVATAR_BADGE_SIZE = 38;

// A glass action pill (icon + label) for the avatar tile's controls.
function AvatarActionPill({
  label,
  icon,
  onPress,
  labelColor,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  // Override the label colour (e.g. destructive red for Remove). Defaults to
  // the normal foreground — never muted, which reads as disabled.
  labelColor?: string;
}) {
  const theme = useTheme();
  return (
    <AppPressable onPress={onPress} accessibilityLabel={label} pressScale={0.05} hitSlop={6}>
      <GlassSurface
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          height: 40,
          paddingHorizontal: 16,
          borderRadius: 20,
        }}
        fallbackStyle={{
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      >
        {icon}
        <Typography
          variant="caption"
          weight="semibold"
          style={{ color: labelColor ?? theme["--color-foreground"] }}
        >
          {label}
        </Typography>
      </GlassSurface>
    </AppPressable>
  );
}

// Avatar upload tile. A large tappable circle: the picked/stored image when one
// exists, otherwise a clean glass well with a camera glyph (no monogram/plus —
// those read as a broken placeholder). A glass camera badge in the corner always
// signals "tap to change", and glass action pills below carry add/replace/remove.
// The image stays local until publish; `imageUrl` is the persona's existing
// uploaded avatar shown when editing.
export function AvatarUploadTile({
  localUri,
  imageUrl = null,
  onPick,
  onRemove,
  busy = false,
}: {
  localUri: string | null;
  imageUrl?: string | null;
  onPick: () => void;
  onRemove: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const uri = localUri ?? imageUrl;
  const hasImage = !!uri;
  const iconProps: IconProps = { size: 15, weight: "bold" };

  return (
    <View style={{ alignItems: "center", gap: 18, paddingVertical: 8 }}>
      <AppPressable
        onPress={onPick}
        disabled={busy}
        accessibilityLabel={
          hasImage ? t("personasCreator.avatarReplace") : t("personasCreator.avatarAdd")
        }
        pressScale={0.05}
        hitSlop={6}
      >
        <View style={{ width: AVATAR_TILE_SIZE, height: AVATAR_TILE_SIZE }}>
          {hasImage ? (
            <Image
              source={{ uri: uri! }}
              style={{
                width: AVATAR_TILE_SIZE,
                height: AVATAR_TILE_SIZE,
                borderRadius: AVATAR_TILE_SIZE / 2,
              }}
              contentFit="cover"
            />
          ) : (
            // Empty state is a neutral dashed "drop well", not a tinted glass
            // circle — otherwise it reads as identical to the primary camera
            // badge. A dashed muted well with a centered camera clearly says
            // "add a photo here".
            <View
              style={{
                width: AVATAR_TILE_SIZE,
                height: AVATAR_TILE_SIZE,
                borderRadius: AVATAR_TILE_SIZE / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme["--color-card-muted"],
                borderWidth: 2,
                borderStyle: "dashed",
                borderColor: theme["--color-primary-muted"],
              }}
            >
              <Camera size={34} weight="regular" color={theme["--color-primary"]} />
            </View>
          )}

          {/* Corner camera badge — only once a photo is set and not loading, so
              the empty well isn't duplicated and the loader never overlaps it. */}
          {hasImage && !busy ? (
            <View style={{ position: "absolute", right: 0, bottom: 0 }}>
              <GlassSurface
                tintColor={theme["--color-primary"]}
                style={{
                  width: AVATAR_BADGE_SIZE,
                  height: AVATAR_BADGE_SIZE,
                  borderRadius: AVATAR_BADGE_SIZE / 2,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                fallbackStyle={{ backgroundColor: theme["--color-primary"] }}
              >
                <Camera size={17} weight="fill" color={theme["--color-primary-foreground"]} />
              </GlassSurface>
            </View>
          ) : null}

          {busy ? (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: AVATAR_TILE_SIZE / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme["--color-overlay"],
              }}
            >
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : null}
        </View>
      </AppPressable>

      {hasImage ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <AvatarActionPill
            label={t("personasCreator.avatarReplace")}
            icon={<Camera {...iconProps} color={theme["--color-foreground"]} />}
            onPress={onPick}
          />
          <AvatarActionPill
            label={t("personasCreator.avatarRemove")}
            icon={<Trash {...iconProps} color={theme["--color-error"]} />}
            onPress={onRemove}
            labelColor={theme["--color-error"]}
          />
        </View>
      ) : (
        <AvatarActionPill
          label={t("personasCreator.avatarAdd")}
          icon={<Camera {...iconProps} color={theme["--color-foreground"]} />}
          onPress={onPick}
        />
      )}
    </View>
  );
}
