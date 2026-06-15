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
import { Camera, Trash, X, type IconProps } from "phosphor-react-native";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, View } from "react-native";

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
        <Input
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          maxLength={maxLength}
          returnKeyType="done"
          blurOnSubmit={false}
          onSubmitEditing={commit}
        />
      ) : null}
    </View>
  );
}

// Curated chips you toggle on/off, plus an optional "add your own" field.
export function MultiSelectPills({
  value,
  onChange,
  options,
  max,
  maxLength,
  allowCustom = false,
  customPlaceholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: readonly string[];
  max: number;
  maxLength: number;
  allowCustom?: boolean;
  customPlaceholder?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [text, setText] = useState("");

  // Show curated options plus any custom values the user already added.
  const extras = value.filter((v) => !options.some((o) => o.toLowerCase() === v.toLowerCase()));
  const all = [...options, ...extras];

  const commitCustom = () => {
    onChange(addTag(value, text, max));
    setText("");
  };

  return (
    <View style={{ gap: 10 }}>
      <ChipWrap>
        {all.map((option) => {
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
        })}
      </ChipWrap>
      {allowCustom && value.length < max ? (
        <Input
          value={text}
          onChangeText={setText}
          placeholder={customPlaceholder}
          maxLength={maxLength}
          returnKeyType="done"
          blurOnSubmit={false}
          onSubmitEditing={commitCustom}
        />
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
  muted = false,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  muted?: boolean;
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
          style={{ color: muted ? theme["--color-foreground-muted"] : theme["--color-foreground"] }}
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
            <GlassSurface
              tintColor={theme["--color-primary"]}
              style={{
                width: AVATAR_TILE_SIZE,
                height: AVATAR_TILE_SIZE,
                borderRadius: AVATAR_TILE_SIZE / 2,
                alignItems: "center",
                justifyContent: "center",
              }}
              fallbackStyle={{
                backgroundColor: theme["--color-primary-subtle"],
                borderWidth: 1,
                borderColor: theme["--color-border"],
              }}
            >
              <Camera size={36} weight="regular" color={theme["--color-primary"]} />
            </GlassSurface>
          )}

          {/* Corner camera badge — always present so the tile reads as editable. */}
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
            icon={<Trash {...iconProps} color={theme["--color-foreground-muted"]} />}
            onPress={onRemove}
            muted
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
