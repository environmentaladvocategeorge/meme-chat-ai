// The persona creator's four step bodies, wired to the react-hook-form context
// the wizard owns. Required fields surface inline errors (mapped from the
// validation codes); the advanced section on the voice step holds the optional
// prompt-craft so the required path stays short.

import { AppPressable } from "@/components/AppPressable";
import { Input } from "@/components/Input";
import {
  AvatarUploadTile,
  MultiSelectPills,
  TypeToPill,
} from "@/components/personaCreator/inputs";
import { ReactionPicker } from "@/components/personaCreator/ReactionPicker";
import { Typography } from "@/components/Typography";
import { LIMITS, type PersonaFormValues, type PersonaStep } from "@/domain/personaForm";
import { useTheme } from "@/hooks/useTheme";
import {
  pickPersonaAvatar,
  PersonaAvatarError,
} from "@/services/firebase/uploadPersonaAvatar";
import { useActiveDraft, usePersonaDraftStore } from "@/store/personaDraft";
import { CaretDown, CaretRight } from "phosphor-react-native";
import { useState } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

const HUMOR_OPTIONS = [
  "deadpan", "sarcastic", "absurd", "chaotic", "roasty",
  "wholesome chaos", "dark playful", "satire", "punny", "gentle teasing",
] as const;

const TONE_OPTIONS = [
  "chill", "hype", "dry", "warm", "loud", "soft", "bleak", "confident", "playful", "lowkey",
] as const;

// ── Field wrappers ────────────────────────────────────────────────────────────

function useErrorText(code?: string): string | null {
  const { t } = useTranslation();
  if (!code) return null;
  return t(`personasCreator.error.${code}`);
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Typography variant="label" style={{ color: theme["--color-foreground"] }}>
        {label}
      </Typography>
      {hint ? (
        <Typography variant="caption" style={{ color: theme["--color-foreground-muted"] }}>
          {hint}
        </Typography>
      ) : null}
    </View>
  );
}

function ControlledInput({
  name,
  label,
  hint,
  placeholder,
  limit,
  multiline,
  rows,
}: {
  name: keyof PersonaFormValues;
  label: string;
  hint?: string;
  placeholder?: string;
  // Soft character limit: every field shows a live counter that goes red once
  // the user types past it (publish stays blocked until it's back under).
  limit: number;
  multiline?: boolean;
  // Render as a tall, top-aligned textarea of roughly this many rows.
  rows?: number;
}) {
  const { control } = useFormContext<PersonaFormValues>();
  const { field, fieldState } = useController({ control, name });
  const errorText = useErrorText(fieldState.error?.message);
  return (
    <View style={{ gap: 8 }}>
      <FieldLabel label={label} hint={hint} />
      <Input
        value={typeof field.value === "string" ? field.value : ""}
        onChangeText={field.onChange}
        onBlur={field.onBlur}
        placeholder={placeholder}
        limit={limit}
        showCount
        multiline={multiline}
        rows={rows}
        error={errorText}
      />
    </View>
  );
}

// Wraps an array-valued field (chips/emoji) with a label + error.
function ControlledTags({
  name,
  label,
  hint,
  children,
}: {
  name: keyof PersonaFormValues;
  label: string;
  hint?: string;
  children: (value: string[], onChange: (next: string[]) => void) => React.ReactNode;
}) {
  const { control } = useFormContext<PersonaFormValues>();
  const { field, fieldState } = useController({ control, name });
  const errorText = useErrorText(fieldState.error?.message);
  const theme = useTheme();
  const value = Array.isArray(field.value) ? (field.value as string[]) : [];
  return (
    <View style={{ gap: 8 }}>
      <FieldLabel label={label} hint={hint} />
      {children(value, field.onChange)}
      {errorText ? (
        <Typography variant="caption" style={{ color: theme["--color-error"] }}>
          {errorText}
        </Typography>
      ) : null}
    </View>
  );
}

// ── Avatar (lives on the draft, not the form) ─────────────────────────────────

function AvatarField() {
  const draft = useActiveDraft();
  const [busy, setBusy] = useState(false);
  const displayName = useWatch<PersonaFormValues, "displayName">({ name: "displayName" }) ?? "";
  const monogram = displayName.trim().charAt(0).toUpperCase() || "?";

  const pick = async () => {
    setBusy(true);
    try {
      const picked = await pickPersonaAvatar("library");
      if (picked) {
        usePersonaDraftStore.getState().updateActive({
          avatar: { localUri: picked.localUri, width: picked.width, height: picked.height },
        });
      }
    } catch (err) {
      if (!(err instanceof PersonaAvatarError)) throw err;
      // Permission denied / cancel-ish: silently no-op (the tile stays as is).
    } finally {
      setBusy(false);
    }
  };

  const remove = () => usePersonaDraftStore.getState().updateActive({ avatar: null });

  return (
    <AvatarUploadTile
      localUri={draft?.avatar?.localUri ?? null}
      monogram={monogram}
      onPick={pick}
      onRemove={remove}
      busy={busy}
    />
  );
}

// ── Advanced expander ─────────────────────────────────────────────────────────

function Advanced({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 14 }}>
      <AppPressable
        onPress={() => setOpen((o) => !o)}
        accessibilityLabel={t("personasCreator.advanced")}
        accessibilityState={{ expanded: open }}
        pressScale={0.02}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}
      >
        {open ? (
          <CaretDown size={16} weight="bold" color={theme["--color-foreground-muted"]} />
        ) : (
          <CaretRight size={16} weight="bold" color={theme["--color-foreground-muted"]} />
        )}
        <Typography variant="body" weight="semibold" style={{ color: theme["--color-foreground"] }}>
          {t("personasCreator.advanced")}
        </Typography>
      </AppPressable>
      {open ? <View style={{ gap: 16 }}>{children}</View> : null}
    </View>
  );
}

// ── Steps ───────────────────────────────────────────────────────────────────

function StepHeader({ step }: { step: PersonaStep }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Typography variant="title-lg" style={{ color: theme["--color-foreground"] }}>
        {t(`personasCreator.step.${step}.title`)}
      </Typography>
      <Typography variant="body" style={{ color: theme["--color-foreground-secondary"] }}>
        {t(`personasCreator.step.${step}.hint`)}
      </Typography>
    </View>
  );
}

function IdentityStep() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="identity" />
      <ControlledInput
        name="displayName"
        label={t("personasCreator.field.name")}
        hint={t("personasCreator.field.nameHint")}
        placeholder={t("personasCreator.field.namePlaceholder")}
        limit={LIMITS.displayName}
      />
      <ControlledInput
        name="shortDescription"
        label={t("personasCreator.field.tagline")}
        hint={t("personasCreator.field.taglineHint")}
        placeholder={t("personasCreator.field.taglinePlaceholder")}
        limit={LIMITS.shortDescription}
      />
    </View>
  );
}

// The avatar is optional and lives on the draft (not the form), so this step
// gates on nothing — the user adds a photo or just taps Next.
function PhotoStep() {
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="photo" />
      <AvatarField />
    </View>
  );
}

// The old "personality" step asked for identity + humor + tone all at once.
// It's now three short steps so each ask stands on its own.

function WhoAreTheyStep() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="whoAreThey" />
      <ControlledInput
        name="identity"
        label={t("personasCreator.field.identity")}
        hint={t("personasCreator.field.identityHint")}
        placeholder={t("personasCreator.field.identityPlaceholder")}
        limit={LIMITS.identity}
        rows={6}
      />
    </View>
  );
}

function HumorStep() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="humor" />
      <ControlledTags name="humorTypes" label={t("personasCreator.field.humor")} hint={t("personasCreator.field.humorHint")}>
        {(value, onChange) => (
          <MultiSelectPills
            value={value}
            onChange={onChange}
            options={HUMOR_OPTIONS}
            max={LIMITS.humorTypesMax}
            maxLength={LIMITS.humorType}
            allowCustom
            customPlaceholder={t("personasCreator.field.humorCustom")}
          />
        )}
      </ControlledTags>
    </View>
  );
}

function ToneStep() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="tone" />
      <ControlledTags name="toneTags" label={t("personasCreator.field.tone")} hint={t("personasCreator.field.toneHint")}>
        {(value, onChange) => (
          <MultiSelectPills
            value={value}
            onChange={onChange}
            options={TONE_OPTIONS}
            max={LIMITS.toneTagsMax}
            maxLength={LIMITS.toneTag}
            allowCustom
            customPlaceholder={t("personasCreator.field.toneCustom")}
          />
        )}
      </ControlledTags>
    </View>
  );
}

function VoiceStep() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="voice" />
      <ControlledTags name="greetingShapes" label={t("personasCreator.field.greetings")} hint={t("personasCreator.field.greetingsHint")}>
        {(value, onChange) => (
          <TypeToPill
            value={value}
            onChange={onChange}
            max={LIMITS.greetingsMax}
            maxLength={LIMITS.greeting}
            placeholder={t("personasCreator.field.greetingsPlaceholder")}
          />
        )}
      </ControlledTags>
      <ControlledInput
        name="emojiPalette"
        label={t("personasCreator.field.emojis")}
        hint={t("personasCreator.field.emojisHint")}
        limit={LIMITS.emoji * LIMITS.emojiMax}
      />
      <ControlledInput
        name="signatureMove"
        label={t("personasCreator.field.signature")}
        hint={t("personasCreator.field.signatureHint")}
        placeholder={t("personasCreator.field.signaturePlaceholder")}
        limit={LIMITS.signatureMove}
      />

      <Advanced>
        <ControlledInput
          name="voiceUser"
          label={t("personasCreator.field.voiceUser")}
          hint={t("personasCreator.field.voiceUserHint")}
          placeholder={t("personasCreator.field.voiceUserPlaceholder")}
          limit={LIMITS.voiceUser}
        />
        <ControlledInput
          name="voiceGood"
          label={t("personasCreator.field.voiceGood")}
          placeholder={t("personasCreator.field.voiceGoodPlaceholder")}
          limit={LIMITS.voiceGood}
          multiline
        />
        <ControlledInput
          name="slangGlosses"
          label={t("personasCreator.field.slang")}
          hint={t("personasCreator.field.slangHint")}
          placeholder={t("personasCreator.field.slangPlaceholder")}
          limit={LIMITS.slangGlosses}
          multiline
        />
        <ControlledInput
          name="mediaLean"
          label={t("personasCreator.field.gifLean")}
          hint={t("personasCreator.field.gifLeanHint")}
          placeholder={t("personasCreator.field.gifLeanPlaceholder")}
          limit={LIMITS.mediaLean}
        />
      </Advanced>
    </View>
  );
}

// The persona's word bank — words/phrases it reaches for, entered as chips.
// Optional and capped (count + per-term length); replaces the old global
// rotating bank, so each bot owns its own vocabulary.
function WordBankStep() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="wordBank" />
      <ControlledTags
        name="wordBank"
        label={t("personasCreator.field.wordBank")}
        hint={t("personasCreator.field.wordBankHint")}
      >
        {(value, onChange) => (
          <TypeToPill
            value={value}
            onChange={onChange}
            max={LIMITS.wordBankMax}
            maxLength={LIMITS.wordBankTerm}
            placeholder={t("personasCreator.field.wordBankPlaceholder")}
          />
        )}
      </ControlledTags>
    </View>
  );
}

// The reaction GIFs/memes the bot reaches for — picked from Klipy, never typed.
// See ReactionPicker for the name-only / local-thumbnail model.
function ReactionsStep() {
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="reactions" />
      <ReactionPicker />
    </View>
  );
}

function ReviewStep() {
  const { t } = useTranslation();
  const theme = useTheme();
  const values = useWatch<PersonaFormValues>() as PersonaFormValues;
  const draft = useActiveDraft();
  const name = values.displayName?.trim() || t("personasCreator.field.namePlaceholder");

  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="review" />
      <View
        style={{
          alignItems: "center",
          gap: 10,
          padding: 18,
          borderRadius: 18,
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      >
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme["--color-card-muted"],
          }}
        >
          <Typography variant="title-lg" style={{ color: theme["--color-foreground"] }}>
            {(draft?.avatar ? "" : name.charAt(0).toUpperCase()) || "?"}
          </Typography>
        </View>
        <Typography variant="title-md" style={{ color: theme["--color-foreground"], textAlign: "center" }}>
          {name}
        </Typography>
        {values.shortDescription ? (
          <Typography
            variant="body"
            style={{ color: theme["--color-foreground-secondary"], textAlign: "center" }}
          >
            {values.shortDescription}
          </Typography>
        ) : null}
      </View>
    </View>
  );
}

export function StepBody({ step }: { step: PersonaStep }) {
  switch (step) {
    case "identity":
      return <IdentityStep />;
    case "photo":
      return <PhotoStep />;
    case "whoAreThey":
      return <WhoAreTheyStep />;
    case "humor":
      return <HumorStep />;
    case "tone":
      return <ToneStep />;
    case "voice":
      return <VoiceStep />;
    case "wordBank":
      return <WordBankStep />;
    case "reactions":
      return <ReactionsStep />;
    case "review":
      return <ReviewStep />;
    default:
      return null;
  }
}
