// Reusable inputs for the persona creator: chip lists, type-to-pill, curated
// multi-select pills, an emoji palette picker, and the avatar upload tile.
// Presentational only — they take a value + onChange and lean on the pure
// tag helpers (domain/tagInput) for add/dedupe/cap rules.

import { AppPressable } from "@/components/AppPressable";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import { addTag, removeTag, toggleTag } from "@/domain/tagInput";
import { useTheme } from "@/hooks/useTheme";
import { Image } from "expo-image";
import { Plus, X } from "phosphor-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

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


// Avatar upload tile: shows the picked local image (or a monogram fallback) and
// a button to pick/replace. The picked image stays local until publish.
export function AvatarUploadTile({
  localUri,
  monogram,
  onPick,
  onRemove,
  busy = false,
}: {
  localUri: string | null;
  monogram: string;
  onPick: () => void;
  onRemove: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={{ alignItems: "center", gap: 10 }}>
      <AppPressable
        onPress={onPick}
        accessibilityLabel={t("personasCreator.avatarPick")}
        pressScale={0.04}
        disabled={busy}
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          backgroundColor: theme["--color-card-muted"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      >
        {localUri ? (
          <Image source={{ uri: localUri }} style={{ width: 96, height: 96 }} contentFit="cover" />
        ) : (
          <View style={{ alignItems: "center", gap: 4 }}>
            <Typography variant="title-lg" style={{ color: theme["--color-foreground"] }}>
              {monogram}
            </Typography>
            <Plus size={16} weight="bold" color={theme["--color-foreground-muted"]} />
          </View>
        )}
      </AppPressable>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <AppPressable onPress={onPick} accessibilityLabel={t("personasCreator.avatarPick")} pressScale={0.04}>
          <Typography variant="caption" weight="semibold" style={{ color: theme["--color-primary"] }}>
            {localUri ? t("personasCreator.avatarReplace") : t("personasCreator.avatarAdd")}
          </Typography>
        </AppPressable>
        {localUri ? (
          <AppPressable onPress={onRemove} accessibilityLabel={t("personasCreator.avatarRemove")} pressScale={0.04}>
            <Typography variant="caption" weight="semibold" style={{ color: theme["--color-foreground-muted"] }}>
              {t("personasCreator.avatarRemove")}
            </Typography>
          </AppPressable>
        ) : null}
      </View>
    </View>
  );
}
