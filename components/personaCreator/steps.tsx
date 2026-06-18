// The persona creator's four step bodies, wired to the react-hook-form context
// the wizard owns. Required fields surface inline errors (mapped from the
// validation codes); the advanced section on the voice step holds the optional
// prompt-craft so the required path stays short.

import { AppPressable } from "@/components/AppPressable";
import { Input } from "@/components/Input";
import { AiDescriptionButton } from "@/components/personaCreator/AiDescriptionButton";
import { AvatarGenerator } from "@/components/personaCreator/AvatarGenerator";
import { ChattinessSlider } from "@/components/personaCreator/ChattinessSlider";
import { PersonaToggleRow } from "@/components/personaCreator/PersonaToggleRow";
import {
  AvatarUploadTile,
  MultilineListInput,
  MultiSelectPills,
  TypeToPill,
  VoiceExamplesField,
} from "@/components/personaCreator/inputs";
import { ReactionPicker } from "@/components/personaCreator/ReactionPicker";
import { SlangTwoPill } from "@/components/personaCreator/SlangTwoPill";
import { useCreatorScratch } from "@/components/personaCreator/CreatorScratch";
import { useCreatorSession } from "@/components/personaCreator/CreatorSession";
import { Typography } from "@/components/Typography";
import {
  CHATTINESS_DEFAULT,
  LIMITS,
  splitEmojis,
  type PersonaFormValues,
  type PersonaStep,
} from "@/domain/personaForm";
import { useTheme } from "@/hooks/useTheme";
import {
  pickPersonaAvatar,
  PersonaAvatarError,
} from "@/services/firebase/uploadPersonaAvatar";
import { gradients } from "@/nativewind-theme";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { CaretRight, PencilSimple } from "phosphor-react-native";
import { useState, type ReactNode } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

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

// Inline validation error for a field whose own input component doesn't render
// one (voice examples, slang, rot levels, reactions). Renders nothing when
// there's no error. Maps the RHF error code to localized copy.
function FieldError({ code }: { code?: string }) {
  const theme = useTheme();
  const text = useErrorText(code);
  if (!text) return null;
  return (
    <Typography variant="caption" style={{ color: theme["--color-error"] }}>
      {text}
    </Typography>
  );
}

function FieldLabel({
  label,
  hint,
  optional,
}: {
  label: string;
  hint?: string;
  // Shows a small "Optional" pill on the right of the label row, instead of
  // spelling it out at the start of the hint.
  optional?: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Typography
          variant="label"
          style={{ flexShrink: 1, color: theme["--color-foreground"] }}
        >
          {label}
        </Typography>
        {optional ? (
          <View
            style={{
              marginLeft: "auto",
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: theme["--color-card-muted"],
              borderWidth: 1,
              borderColor: theme["--color-border"],
            }}
          >
            <Typography
              variant="caption"
              weight="medium"
              style={{ color: theme["--color-foreground-muted"] }}
            >
              {t("personasCreator.field.optional")}
            </Typography>
          </View>
        ) : null}
      </View>
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
  optional,
  placeholder,
  limit,
  multiline,
  rows,
}: {
  name: keyof PersonaFormValues;
  // Omit on a single-field step where the StepHeader already titles it — a field
  // label that repeats the step title just reads as duplicated text.
  label?: string;
  hint?: string;
  optional?: boolean;
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
      {label ? <FieldLabel label={label} hint={hint} optional={optional} /> : null}
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
  optional,
  children,
}: {
  name: keyof PersonaFormValues;
  label: string;
  hint?: string;
  optional?: boolean;
  children: (value: string[], onChange: (next: string[]) => void) => React.ReactNode;
}) {
  const { control } = useFormContext<PersonaFormValues>();
  const { field, fieldState } = useController({ control, name });
  const errorText = useErrorText(fieldState.error?.message);
  const theme = useTheme();
  const value = Array.isArray(field.value) ? (field.value as string[]) : [];
  return (
    <View style={{ gap: 8 }}>
      <FieldLabel label={label} hint={hint} optional={optional} />
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
  const { avatar, setLocalAvatar, removeAvatar } = useCreatorSession();
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    setBusy(true);
    try {
      const picked = await pickPersonaAvatar("library");
      if (picked) {
        setLocalAvatar({
          localUri: picked.localUri,
          width: picked.width,
          height: picked.height,
        });
      }
    } catch (err) {
      if (!(err instanceof PersonaAvatarError)) throw err;
      // Permission denied / cancel-ish: silently no-op (the tile stays as is).
    } finally {
      setBusy(false);
    }
  };

  return (
    <AvatarUploadTile
      localUri={avatar.kind === "local" ? avatar.localUri : null}
      imageUrl={avatar.kind === "remote" ? avatar.url : null}
      onPick={pick}
      onRemove={removeAvatar}
      busy={busy}
    />
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
        multiline
        rows={2}
      />
    </View>
  );
}

// The avatar is optional and lives on the draft (not the form), so this step
// gates on nothing — the user adds a photo, generates one from a description, or
// just taps Next. Both paths feed the same { kind: "local" } session avatar.
function PhotoStep() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="photo" />
      <AvatarField />
      {/* "or" divider between picking a photo and generating one. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            flex: 1,
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme["--color-border"],
          }}
        />
        <Typography
          variant="caption"
          weight="semibold"
          style={{ color: theme["--color-foreground-muted"] }}
        >
          {t("personasCreator.avatarGen.or")}
        </Typography>
        <View
          style={{
            flex: 1,
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme["--color-border"],
          }}
        />
      </View>
      <AvatarGenerator />
    </View>
  );
}

// The old "personality" step asked for identity + humor + tone all at once.
// It's now three short steps so each ask stands on its own.

function WhoAreTheyStep() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 18 }}>
      {/* Single-field step: the header already titles it ("Who are they?"), so
          the input drops its label/hint to avoid repeating the same text. */}
      <StepHeader step="whoAreThey" />
      <ControlledInput
        name="identity"
        placeholder={t("personasCreator.field.identityPlaceholder")}
        limit={LIMITS.identity}
        rows={6}
      />
      <OrDivider />
      {/* AI assist: writes the description from the details + avatar so far. */}
      <AiDescriptionButton />
    </View>
  );
}

// A thin "or" separator between the manual description and the AI option.
function OrDivider() {
  const { t } = useTranslation();
  const theme = useTheme();
  const line = {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme["--color-border"],
  } as const;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={line} />
      <Typography variant="caption" style={{ color: theme["--color-foreground-muted"] }}>
        {t("personasCreator.aiDescribe.or")}
      </Typography>
      <View style={line} />
    </View>
  );
}

// The current display name (or a neutral fallback) for interpolating into the
// per-page toggle labels.
function useBotName() {
  const { t } = useTranslation();
  const displayName = (useWatch<PersonaFormValues>({ name: "displayName" }) as string)?.trim();
  return displayName || t("personasCreator.field.botFallback");
}

// Wraps an optional section in a "let the model decide" toggle bound to a real,
// persisted form flag (e.g. autoTone) — NOT local UI state. So it starts OFF on
// a fresh persona (we never pre-select it), captures the choice on save, and
// reflects exactly that choice on edit. Turning it ON clears the section's value
// and hides the input, so the payload omits it and the backend lets the bot
// improvise. Mirrors how autoHumor / autoWordBank already work.
function SkippableField({
  field,
  flagField,
  label,
  emptyValue,
  children,
}: {
  field: keyof PersonaFormValues;
  // The persisted boolean toggle field (autoTone, autoEmoji, …).
  flagField: keyof PersonaFormValues;
  label: string;
  emptyValue: unknown;
  children: React.ReactNode;
}) {
  const { control, setValue } = useFormContext<PersonaFormValues>();
  const { field: flag } = useController({ control, name: flagField });
  const skip = Boolean(flag.value);
  const onToggle = (next: boolean) => {
    flag.onChange(next);
    if (next) {
      setValue(field, emptyValue as never, { shouldDirty: true, shouldValidate: true });
    }
  };
  return (
    <View style={{ gap: 14 }}>
      <PersonaToggleRow label={label} value={skip} onValueChange={onToggle} />
      {skip ? null : children}
    </View>
  );
}

// Chattiness + humor on one page (chattiness has no skip of its own). Humor
// carries its own "let the bot decide" toggle (autoHumor, a real form field
// since it waives the humor requirement).
function HumorStep() {
  const { t } = useTranslation();
  const { control } = useFormContext<PersonaFormValues>();
  const autoHumor = useController({ control, name: "autoHumor" });
  const botName = useBotName();
  const isAuto = Boolean(autoHumor.field.value);
  return (
    <View style={{ gap: 22 }}>
      <StepHeader step="humor" />
      <ChattinessSlider />
      <View style={{ gap: 14 }}>
        <PersonaToggleRow
          label={t("personasCreator.field.autoHumor", { name: botName })}
          value={isAuto}
          onValueChange={autoHumor.field.onChange}
        />
        {!isAuto ? (
          <ControlledTags
            name="humorTypes"
            label={t("personasCreator.field.humor")}
            hint={t("personasCreator.field.humorHint")}
          >
            {(value, onChange) => (
              <MultiSelectPills
                value={value}
                onChange={onChange}
                options={HUMOR_OPTIONS}
                max={LIMITS.humorTypesMax}
                maxLength={LIMITS.humorType}
                allowCustom
                horizontal
                bleed={20}
                customPlaceholder={t("personasCreator.field.humorCustom")}
              />
            )}
          </ControlledTags>
        ) : null}
      </View>
    </View>
  );
}

function VibeStep() {
  const { t } = useTranslation();
  const botName = useBotName();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="vibe" />
      <SkippableField
        field="toneTags"
        flagField="autoTone"
        label={t("personasCreator.skip.tone", { name: botName })}
        emptyValue={[]}
      >
        <ControlledTags
          name="toneTags"
          label={t("personasCreator.field.tone")}
          hint={t("personasCreator.field.toneHint")}
        >
          {(value, onChange) => (
            <MultiSelectPills
              value={value}
              onChange={onChange}
              options={TONE_OPTIONS}
              max={LIMITS.toneTagsMax}
              maxLength={LIMITS.toneTag}
              allowCustom
              horizontal
              bleed={20}
              customPlaceholder={t("personasCreator.field.toneCustom")}
            />
          )}
        </ControlledTags>
      </SkippableField>
    </View>
  );
}

function GreetingsStep() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { control } = useFormContext<PersonaFormValues>();
  const autoGreet = useController({ control, name: "autoGreet" });
  const greetings = useController({ control, name: "greetingShapes" });
  const greetingErr = useErrorText(greetings.fieldState.error?.message);
  const botName = useBotName();
  const isAuto = Boolean(autoGreet.field.value);
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="greetings" />
      <View style={{ gap: 14 }}>
        <PersonaToggleRow
          label={t("personasCreator.field.autoGreet", { name: botName })}
          value={isAuto}
          onValueChange={autoGreet.field.onChange}
        />
        {!isAuto ? (
          <>
            <MultilineListInput
              value={(greetings.field.value as string[]) ?? []}
              onChange={greetings.field.onChange}
              max={LIMITS.greetingsMax}
              maxLength={LIMITS.greeting}
              rows={3}
              placeholder={t("personasCreator.field.greetingsPlaceholder")}
              addLabel={t("personasCreator.field.greetingsAdd")}
            />
            {greetingErr ? (
              <Typography variant="caption" style={{ color: theme["--color-error"] }}>
                {greetingErr}
              </Typography>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

function EmojiStep() {
  const { t } = useTranslation();
  const botName = useBotName();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="emoji" />
      <SkippableField
        field="emojiPalette"
        flagField="autoEmoji"
        label={t("personasCreator.skip.emoji", { name: botName })}
        emptyValue=""
      >
        <ControlledInput
          name="emojiPalette"
          label={t("personasCreator.field.emojis")}
          hint={t("personasCreator.field.emojisHint")}
          limit={LIMITS.emoji * LIMITS.emojiMax}
        />
      </SkippableField>
    </View>
  );
}

function CatchphraseStep() {
  const { t } = useTranslation();
  const botName = useBotName();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="catchphrase" />
      <SkippableField
        field="signatureMove"
        flagField="autoSignature"
        label={t("personasCreator.skip.catchphrase", { name: botName })}
        emptyValue=""
      >
        <ControlledInput
          name="signatureMove"
          label={t("personasCreator.field.signature")}
          hint={t("personasCreator.field.signatureHint")}
          placeholder={t("personasCreator.field.signaturePlaceholder")}
          limit={LIMITS.signatureMove}
          multiline
          rows={2}
        />
      </SkippableField>
    </View>
  );
}

function VoiceExamplesStep() {
  const { t } = useTranslation();
  const { control } = useFormContext<PersonaFormValues>();
  const voiceExamples = useController({ control, name: "voiceExamples" });
  const botName = useBotName();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="voiceExamples" />
      <SkippableField
        field="voiceExamples"
        flagField="autoVoiceExamples"
        label={t("personasCreator.skip.voiceExamples", { name: botName })}
        emptyValue={[]}
      >
        <View style={{ gap: 8 }}>
          <VoiceExamplesField
            value={(voiceExamples.field.value as { user: string; good: string }[]) ?? []}
            onChange={voiceExamples.field.onChange}
            max={LIMITS.voiceExamplesMax}
            userMax={LIMITS.voiceUser}
            goodMax={LIMITS.voiceGood}
            userPlaceholder={t("personasCreator.field.voiceUserPlaceholder")}
            goodPlaceholder={t("personasCreator.field.voiceGoodPlaceholder")}
            addLabel={t("personasCreator.field.voiceExamplesAdd")}
          />
          <FieldError code={voiceExamples.fieldState.error?.message} />
        </View>
      </SkippableField>
    </View>
  );
}

// The persona's go-to words/phrases (plain vocabulary, no meanings). Required a
// minimum unless autoWordBank. Slang (terms + meanings) lives on its own page now.
function WordBankStep() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { control } = useFormContext<PersonaFormValues>();
  const autoWordBank = useController({ control, name: "autoWordBank" });
  const botName = useBotName();
  const isAuto = Boolean(autoWordBank.field.value);
  const wordBank = (useWatch<PersonaFormValues>({ name: "wordBank" }) as string[]) ?? [];
  const met = wordBank.length >= LIMITS.wordBankMin;
  const counterColor = met ? theme["--color-success"] : theme["--color-foreground-muted"];
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="wordBank" />
      <PersonaToggleRow
        label={t("personasCreator.field.autoWordBank", { name: botName })}
        value={isAuto}
        onValueChange={autoWordBank.field.onChange}
      />
      {!isAuto ? (
        <>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: met
                  ? theme["--color-success"]
                  : theme["--color-border-strong"],
              }}
            />
            <Typography variant="caption" weight="semibold" style={{ color: counterColor }}>
              {t("personasCreator.field.wordBankCount", {
                count: Math.min(wordBank.length, LIMITS.wordBankMin),
                min: LIMITS.wordBankMin,
              })}
            </Typography>
          </View>
        </>
      ) : null}
    </View>
  );
}

function SlangStep() {
  const { t } = useTranslation();
  const { control } = useFormContext<PersonaFormValues>();
  const slang = useController({ control, name: "slangGlosses" });
  const botName = useBotName();
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="slang" />
      <SkippableField
        field="slangGlosses"
        flagField="autoSlang"
        label={t("personasCreator.skip.slang", { name: botName })}
        emptyValue=""
      >
        <View style={{ gap: 10 }}>
          <FieldLabel
            label={t("personasCreator.field.slang")}
            hint={t("personasCreator.field.slangHint")}
          />
          <SlangTwoPill
            value={(slang.field.value as string) ?? ""}
            onChange={slang.field.onChange}
          />
          <FieldError code={slang.fieldState.error?.message} />
        </View>
      </SkippableField>
    </View>
  );
}

// The persona's own three Rot Level block bodies. Skipped by default (the
// backend then uses its generic dial); authoring all three sends them.
function RotLevelsStep() {
  const { t } = useTranslation();
  const { control } = useFormContext<PersonaFormValues>();
  const rot = useController({ control, name: "rotLevels" });
  const botName = useBotName();
  const blocks = (rot.field.value as string[]) ?? ["", "", ""];
  const setBlock = (i: number, text: string) => {
    const next = [blocks[0] ?? "", blocks[1] ?? "", blocks[2] ?? ""];
    next[i] = text;
    rot.field.onChange(next);
  };
  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="rotLevels" />
      <SkippableField
        field="rotLevels"
        flagField="autoRotLevels"
        label={t("personasCreator.skip.rotLevels", { name: botName })}
        emptyValue={["", "", ""]}
      >
        <View style={{ gap: 16 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ gap: 8 }}>
              <FieldLabel
                label={t(`personasCreator.field.rotLevel.${i + 1}`)}
                hint={t(`personasCreator.field.rotLevelHint.${i + 1}`)}
              />
              <Input
                value={blocks[i] ?? ""}
                onChangeText={(text) => setBlock(i, text)}
                placeholder={t(`personasCreator.field.rotLevelPlaceholder.${i + 1}`)}
                multiline
                numberOfLines={4}
                maxLength={LIMITS.rotLevelBody}
              />
            </View>
          ))}
          <FieldError code={rot.fieldState.error?.message} />
        </View>
      </SkippableField>
    </View>
  );
}

// The reaction GIFs/memes the bot reaches for — picked from Klipy, never typed.
// See ReactionPicker for the name-only / local-thumbnail model.
//
// WHICH gifs (the picked favorites) is decoupled from WHEN it sends them: the
// picker is ALWAYS visible (favorites are optional but never hidden), and a
// separate "let {bot} decide when to send" toggle (autoMedia) hands the cadence
// to the bot. The two coexist — you can pick favorites AND let the bot decide
// when. Toggling auto on clears the hand-written cadence note (it's moot once
// delegated). The reactions step still gates on "pick a favorite OR delegate"
// (validateField: mediaPills required unless autoMedia), so it can't be silently
// skipped.
function ReactionsStep() {
  const { t } = useTranslation();
  const { control, setValue } = useFormContext<PersonaFormValues>();
  const autoMedia = useController({ control, name: "autoMedia" });
  const mediaPills = useController({ control, name: "mediaPills" });
  const botName = useBotName();
  const isAuto = Boolean(autoMedia.field.value);

  const onToggleAuto = (next: boolean) => {
    autoMedia.field.onChange(next);
    if (next) {
      setValue("mediaLean", "", { shouldDirty: true, shouldValidate: true });
    }
  };

  return (
    <View style={{ gap: 18 }}>
      <StepHeader step="reactions" />
      {/* WHICH gifs — favorites, always pickable, independent of the cadence
          decision below. */}
      <ReactionPicker />
      <FieldError code={mediaPills.fieldState.error?.message} />
      {/* WHEN it sends — describe the cadence, or hand it to the bot. */}
      <View style={{ gap: 14 }}>
        <PersonaToggleRow
          label={t("personasCreator.field.autoMedia", { name: botName })}
          value={isAuto}
          onValueChange={onToggleAuto}
        />
        {!isAuto ? (
          <ControlledInput
            name="mediaLean"
            label={t("personasCreator.field.gifLean")}
            hint={t("personasCreator.field.gifLeanHint")}
            placeholder={t("personasCreator.field.gifLeanPlaceholder")}
            limit={LIMITS.mediaLean}
            optional
          />
        ) : null}
      </View>
    </View>
  );
}

// A read-only chip row for an array field in the review summary (humor, tone,
// greetings, word bank, reaction picks). Soft pill with a hint of accent.
function SummaryChips({ items }: { items: string[] }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
      {items.map((item, i) => (
        <View
          key={`${item}-${i}`}
          style={{
            paddingHorizontal: 11,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: theme["--color-card-muted"],
            borderWidth: 1,
            borderColor: theme["--color-primary-muted"],
          }}
        >
          <Typography variant="caption" weight="medium" style={{ color: theme["--color-foreground"] }}>
            {item}
          </Typography>
        </View>
      ))}
    </View>
  );
}

// One field in the review summary: a small uppercase label over its value, a
// tap target that jumps to the step that edits it (`step`), and a caret. Kept
// open (no card) so the whole summary reads as a clean editorial list.
type ReviewDetail = { key: string; label: string; content: ReactNode; step: PersonaStep };

function ReviewStep() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const accentGradient = gradients[colorScheme ?? "light"].accent;
  const values = useWatch<PersonaFormValues>() as PersonaFormValues;
  const { avatar, mediaPicks } = useCreatorSession();
  // Lets each row (and the hero) jump straight to the step that edits it.
  const { goToStep } = useCreatorScratch();
  // The avatar carries the pixels regardless of mode: a freshly-picked local
  // image (create / replace) or the persona's already-uploaded URL (edit).
  const avatarUri =
    avatar.kind === "local"
      ? avatar.localUri
      : avatar.kind === "remote"
        ? avatar.url
        : null;
  const name = values.displayName?.trim() || t("personasCreator.field.namePlaceholder");
  const monogram = name.charAt(0).toUpperCase() || "?";

  const bodyStyle = { color: theme["--color-foreground"], lineHeight: 21 } as const;
  const text = (value: string) => (
    <Typography variant="body" style={bodyStyle}>
      {value}
    </Typography>
  );
  // Muted, italic line for an optional section the user left for the bot to
  // handle. Shown instead of omitting the section, so the overview lists every
  // option and the user can see (and tap to change) what they're leaving to AI.
  const modelDecides = (
    <Typography
      variant="body"
      style={{ color: theme["--color-foreground-muted"], fontStyle: "italic" }}
    >
      {t("personasCreator.review.modelDecides", { name })}
    </Typography>
  );
  const emojis = splitEmojis(values.emojiPalette);
  const voiceExamples = values.voiceExamples.filter(
    (ex) => ex.user.trim().length > 0 && ex.good.trim().length > 0,
  );

  const details: ReviewDetail[] = [];
  // Required/always-present text: only pushed when it has a value (never falls
  // back to "model decides" — these aren't optional).
  const pushText = (key: string, label: string, step: PersonaStep, value: string) => {
    if (value.trim()) details.push({ key, label: t(label), step, content: text(value.trim()) });
  };
  // Optional section: show the value, or the muted "letting {name} decide" line.
  const pushOptionalText = (key: string, label: string, step: PersonaStep, value: string) => {
    details.push({ key, label: t(label), step, content: value.trim() ? text(value.trim()) : modelDecides });
  };
  const pushOptionalChips = (key: string, label: string, step: PersonaStep, items: string[]) => {
    details.push({
      key,
      label: t(label),
      step,
      content: items.length > 0 ? <SummaryChips items={items} /> : modelDecides,
    });
  };
  // A flagged "let the bot decide" section (humor/greet/wordBank/media): the
  // exact toggle label when on, the picked chips when authored, else the muted
  // model-decides line (a not-authored, not-toggled optional).
  const pushAutoOr = (
    on: boolean,
    autoLabelKey: string,
    key: string,
    sectionLabel: string,
    step: PersonaStep,
    chips: string[],
  ) => {
    details.push({
      key,
      label: t(sectionLabel),
      step,
      content: on
        ? text(t(autoLabelKey, { name }))
        : chips.length > 0
          ? <SummaryChips items={chips} />
          : modelDecides,
    });
  };

  pushText("identity", "personasCreator.field.identity", "whoAreThey", values.identity);
  // Chattiness is always set (a 1–5 dial), so show its stage name outright.
  const chattinessStage = Math.min(
    5,
    Math.max(1, Math.round(values.chattiness || CHATTINESS_DEFAULT)),
  );
  details.push({
    key: "chattiness",
    label: t("personasCreator.field.chattiness"),
    step: "humor",
    content: text(t(`personasCreator.field.chattinessStage.${chattinessStage}`)),
  });
  pushAutoOr(
    Boolean(values.autoHumor),
    "personasCreator.field.autoHumor",
    "humor",
    "personasCreator.field.humor",
    "humor",
    values.humorTypes,
  );
  pushOptionalChips("tone", "personasCreator.field.tone", "vibe", values.toneTags);
  pushAutoOr(
    Boolean(values.autoGreet),
    "personasCreator.field.autoGreet",
    "greetings",
    "personasCreator.field.greetings",
    "greetings",
    values.greetingShapes,
  );
  details.push({
    key: "emojis",
    label: t("personasCreator.field.emojis"),
    step: "emoji",
    content:
      emojis.length > 0 ? <Typography variant="title-md">{emojis.join(" ")}</Typography> : modelDecides,
  });
  pushOptionalText("signature", "personasCreator.field.signature", "catchphrase", values.signatureMove);
  pushAutoOr(
    Boolean(values.autoWordBank),
    "personasCreator.field.autoWordBank",
    "wordBank",
    "personasCreator.field.wordBank",
    "wordBank",
    values.wordBank,
  );
  details.push({
    key: "voice",
    label: t("personasCreator.field.voiceExamples"),
    step: "voiceExamples",
    content:
      voiceExamples.length > 0 ? (
        <View style={{ gap: 10 }}>
          {voiceExamples.map((ex, i) => (
            <View key={i} style={{ gap: 3 }}>
              <Typography variant="body" style={{ color: theme["--color-foreground-secondary"] }}>
                {`“${ex.user.trim()}”`}
              </Typography>
              <Typography variant="body" style={bodyStyle}>
                {ex.good.trim()}
              </Typography>
            </View>
          ))}
        </View>
      ) : (
        modelDecides
      ),
  });
  pushOptionalText("slang", "personasCreator.field.slang", "slang", values.slangGlosses);
  // Custom intensity levels: each of the 3 is optional; blanks fall back to the
  // built-in defaults. Authored → show them; none → letting the bot decide.
  const rotLevels = values.rotLevels
    .map((body, i) => ({ body: body.trim(), label: t(`personasCreator.field.rotLevel.${i + 1}`) }))
    .filter((r) => r.body.length > 0);
  details.push({
    key: "rotLevels",
    label: t("personasCreator.step.rotLevels.title"),
    step: "rotLevels",
    content:
      rotLevels.length > 0 ? (
        <View style={{ gap: 10 }}>
          {rotLevels.map((r, i) => (
            <View key={i} style={{ gap: 3 }}>
              <Typography
                variant="caption"
                weight="semibold"
                style={{ color: theme["--color-foreground-secondary"] }}
              >
                {r.label}
              </Typography>
              <Typography variant="body" style={bodyStyle}>
                {r.body}
              </Typography>
            </View>
          ))}
        </View>
      ) : (
        modelDecides
      ),
  });
  // Media: WHICH (picked favorites) and WHEN (let the bot decide) coexist now,
  // so the row shows both — chips for the favorites, plus a muted line when the
  // cadence is delegated. Neither set → the model decides everything.
  const mediaNames = mediaPicks.map((m) => m.name);
  details.push({
    key: "gifs",
    label: t("personasCreator.field.gifs"),
    step: "reactions",
    content:
      mediaNames.length > 0 || values.autoMedia ? (
        <View style={{ gap: 8 }}>
          {mediaNames.length > 0 ? <SummaryChips items={mediaNames} /> : null}
          {values.autoMedia ? (
            <Typography
              variant="body"
              style={{ color: theme["--color-foreground-muted"], fontStyle: "italic" }}
            >
              {t("personasCreator.field.autoMedia", { name })}
            </Typography>
          ) : null}
        </View>
      ) : (
        modelDecides
      ),
  });
  pushText("gifLean", "personasCreator.field.gifLean", "reactions", values.mediaLean);

  return (
    <View style={{ gap: 24 }}>
      <StepHeader step="review" />

      {/* Hero — open on the background, no card. Avatar (tap → photo step) with
          an accent ring + edit badge, name/tagline (tap → identity step), and a
          gradient underline so the page has life. */}
      <View style={{ alignItems: "center", gap: 12 }}>
        <AppPressable
          onPress={() => goToStep("photo")}
          accessibilityRole="button"
          accessibilityLabel={t("personasCreator.review.editPhoto")}
          pressScale={0.04}
          hitSlop={6}
        >
          <View>
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  borderWidth: 3,
                  borderColor: theme["--color-primary-muted"],
                  backgroundColor: theme["--color-card-muted"],
                }}
                contentFit="cover"
              />
            ) : (
              <View
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 3,
                  borderColor: theme["--color-primary-muted"],
                  backgroundColor: theme["--color-card-muted"],
                }}
              >
                <Typography variant="title-xl" style={bodyStyle}>
                  {monogram}
                </Typography>
              </View>
            )}
            {/* Small edit badge so the avatar reads as tappable. */}
            <View
              style={{
                position: "absolute",
                right: -2,
                bottom: -2,
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme["--color-primary"],
                borderWidth: 2,
                borderColor: theme["--color-background"],
              }}
            >
              <PencilSimple size={14} weight="bold" color={theme["--color-primary-foreground"]} />
            </View>
          </View>
        </AppPressable>
        <AppPressable
          onPress={() => goToStep("identity")}
          accessibilityRole="button"
          accessibilityLabel={t("personasCreator.review.editIdentity")}
          pressScale={0.02}
          hitSlop={6}
          style={{ alignItems: "center", gap: 5 }}
        >
          <Typography
            variant="title-xl"
            style={{ color: theme["--color-foreground"], textAlign: "center" }}
          >
            {name}
          </Typography>
          {values.shortDescription ? (
            <Typography
              variant="body"
              style={{
                color: theme["--color-foreground-muted"],
                textAlign: "center",
                maxWidth: 320,
              }}
            >
              {values.shortDescription}
            </Typography>
          ) : null}
        </AppPressable>
        <View
          pointerEvents="none"
          style={{
            width: 116,
            height: 4,
            borderRadius: 99,
            overflow: "hidden",
            marginTop: 2,
            opacity: 0.85,
          }}
        >
          <LinearGradient
            colors={accentGradient.colors}
            start={accentGradient.start}
            end={accentGradient.end}
            style={StyleSheet.absoluteFillObject}
          />
        </View>
      </View>

      {/* Details — a clean dividered list, no card wrapper. Each row is a tap
          target that jumps to the step editing it, with a trailing caret. */}
      {details.length > 0 ? (
        <View>
          {details.map((d, i) => (
            <View key={d.key}>
              {i > 0 ? (
                <View
                  style={{
                    height: StyleSheet.hairlineWidth,
                    backgroundColor: theme["--color-border"],
                  }}
                />
              ) : null}
              <AppPressable
                onPress={() => goToStep(d.step)}
                accessibilityRole="button"
                accessibilityLabel={t("personasCreator.review.editSection", { section: d.label })}
                pressScale={0.01}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 14,
                }}
              >
                <View style={{ flex: 1, gap: 7 }}>
                  <Typography
                    variant="caption"
                    weight="semibold"
                    style={{
                      color: theme["--color-foreground-muted"],
                      textTransform: "uppercase",
                      letterSpacing: 0.6,
                    }}
                  >
                    {d.label}
                  </Typography>
                  {d.content}
                </View>
                <CaretRight size={18} weight="bold" color={theme["--color-foreground-muted"]} />
              </AppPressable>
            </View>
          ))}
        </View>
      ) : null}
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
    case "vibe":
      return <VibeStep />;
    case "greetings":
      return <GreetingsStep />;
    case "emoji":
      return <EmojiStep />;
    case "catchphrase":
      return <CatchphraseStep />;
    case "voiceExamples":
      return <VoiceExamplesStep />;
    case "wordBank":
      return <WordBankStep />;
    case "slang":
      return <SlangStep />;
    case "reactions":
      return <ReactionsStep />;
    case "rotLevels":
      return <RotLevelsStep />;
    case "review":
      return <ReviewStep />;
    default:
      return null;
  }
}
