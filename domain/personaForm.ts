// ── Persona creator form (client domain) ─────────────────────────────────────
// The form shape the persona creator collects, the validation behind it, and
// the mapping to the savePersona payload. Pure and dependency-free: the
// constraints MIRROR the backend userPersonaInputSchema (the real gate) so the
// client can validate per-step without shipping zod. A parity test pins the
// numbers; if the backend limits move, that test fails first.
//
// Two fields the backend seeds are intentionally NOT collected here:
// voiceExample.bad (the persona-dropped example) and slang.usageNotes (a safety
// boundary). The avatar is handled separately (a local image URI on the draft,
// uploaded at publish), so it isn't part of these values either.

// Character/array limits — mirror functions/src/personas/userPersonas.ts.
export const LIMITS = {
  displayName: 40,
  identity: 600,
  shortDescription: 160,
  voiceUser: 300,
  voiceGood: 500,
  signatureMove: 200,
  greeting: 120,
  greetingsMax: 6,
  humorType: 40,
  humorTypesMax: 8,
  humorExample: 160,
  humorExamplesMax: 6,
  slangGlosses: 1200,
  emoji: 8,
  emojiMax: 20,
  toneTag: 24,
  toneTagsMax: 5,
  wordBankTerm: 60,
  wordBankMax: 40,
  // The word bank is now required: at least this many terms before publish.
  // Client-only gate (the backend keeps it optional), so it can tighten the
  // builder UX without rejecting personas saved under the old rules.
  wordBankMin: 3,
  mediaPill: 60,
  mediaPillsMax: 10,
  mediaLean: 200,
  // Up to this many voice-example pairs (message → reply) the bot can carry.
  voiceExamplesMax: 5,
  // Per-level Rot Level block body cap (mirrors the backend rotLevels item cap).
  rotLevelBody: 1500,
} as const;

// Reply-length dial bounds (1 = curt … 5 = chatty). The middle is the default
// and renders byte-identical to the original fixed wording.
export const CHATTINESS_MIN = 1;
export const CHATTINESS_MAX = 5;
export const CHATTINESS_DEFAULT = 3;

export type PersonaFormValues = {
  displayName: string;
  shortDescription: string;
  identity: string;
  // Reply-length dial (1–5). Always set; the middle is the byte-identical default.
  chattiness: number;
  toneTags: string[];
  // "Let the bot decide" for vibe tags. Persisted (no prompt effect of its own)
  // purely so editing reflects the choice; mirrors autoWordBank.
  autoTone: boolean;
  humorTypes: string[];
  // When true the bot infers its own humor from its identity (humorTypes
  // optional). Mirrors autoGreet.
  autoHumor: boolean;
  greetingShapes: string[];
  // When true the bot may write its own greetings (greetingShapes optional).
  autoGreet: boolean;
  // A free-typed string of emojis (split into the backend's array at payload
  // time). The user just types the ones the bot reaches for. Optional.
  emojiPalette: string;
  // "Let the bot decide" for the emoji palette (persisted for edit round-trip).
  autoEmoji: boolean;
  signatureMove: string;
  // "Let the bot decide" for the catchphrase/signature move (edit round-trip).
  autoSignature: boolean;
  // The persona's word bank — words/phrases it reaches for, as chips. Required
  // (a minimum count) at publish unless autoWordBank is on; see validateField.
  wordBank: string[];
  // When true the bot uses its own natural vocabulary (no fixed word bank): the
  // min-count requirement is waived and no wordBank is sent. Mirrors autoGreet.
  autoWordBank: boolean;
  // Advanced / optional.
  humorExampleShapes: string[];
  // Up to LIMITS.voiceExamplesMax message→reply pairs showing the bot's voice.
  voiceExamples: { user: string; good: string }[];
  // "Let the bot decide" for voice examples (persisted for edit round-trip).
  autoVoiceExamples: boolean;
  slangGlosses: string;
  // "Let the bot decide" for the slang glossary (persisted for edit round-trip).
  autoSlang: boolean;
  mediaPills: string[];
  mediaLean: string;
  // When true the bot may send its own reaction GIFs/memes freely (mirrors
  // autoGreet for greetings). Picked reaction pills stay optional either way.
  autoMedia: boolean;
  // The persona's own three Rot Level block bodies (index 0 = level 1, …). Empty
  // strings = not customized; the backend then uses its generic default dial.
  // Always length 3.
  rotLevels: string[];
  // "Let the bot decide" for the custom Rot Level dial (persisted for edit
  // round-trip; the backend already falls back to its default dial when absent).
  autoRotLevels: boolean;
};

export const EMPTY_PERSONA_FORM: PersonaFormValues = {
  displayName: "",
  shortDescription: "",
  identity: "",
  chattiness: CHATTINESS_DEFAULT,
  toneTags: [],
  autoTone: false,
  humorTypes: [],
  autoHumor: false,
  greetingShapes: [],
  autoGreet: false,
  emojiPalette: "",
  autoEmoji: false,
  signatureMove: "",
  autoSignature: false,
  wordBank: [],
  autoWordBank: false,
  humorExampleShapes: [],
  voiceExamples: [],
  autoVoiceExamples: false,
  slangGlosses: "",
  autoSlang: false,
  mediaPills: [],
  mediaLean: "",
  autoMedia: false,
  rotLevels: ["", "", ""],
  autoRotLevels: false,
};

// The seed for a BRAND-NEW persona. Every "let {bot} decide" toggle starts OFF:
// the user opts into letting the model decide, we never pre-select it for them.
// (It's still identical to EMPTY today; kept as a distinct named seed so the
// creator's starting point has one obvious home if it ever diverges again.)
export const NEW_PERSONA_FORM: PersonaFormValues = {
  ...EMPTY_PERSONA_FORM,
  autoHumor: false,
  autoGreet: false,
  autoWordBank: false,
  autoMedia: false,
};

// The wizard's primary steps and the field each one gates Next on. Every step
// after "whoAreThey" carries a "let {bot} decide" toggle; the field it lists is
// "required UNLESS its toggle is on" (validateField reads the matching auto*
// flag). So the user must make a deliberate choice on each section — author it,
// or delegate it — and can't silently skip an undecided section. The avatar
// (photo) lives on the draft, not the form, so it gates on nothing.
export const PERSONA_STEPS = [
  "identity",
  "photo",
  "whoAreThey",
  // Chattiness + humor share one page (chattiness has no skip of its own).
  "humor",
  "vibe",
  "greetings",
  "emoji",
  "catchphrase",
  "voiceExamples",
  "wordBank",
  "slang",
  "reactions",
  "rotLevels",
  "review",
] as const;
export type PersonaStep = (typeof PERSONA_STEPS)[number];

export const PERSONA_STEP_FIELDS: Record<PersonaStep, (keyof PersonaFormValues)[]> = {
  identity: ["displayName", "shortDescription"],
  // The avatar is optional and lives on the draft (not the form), so the photo
  // step gates on nothing — Next always proceeds.
  photo: [],
  whoAreThey: ["identity"],
  // Each of these is "required unless its auto* toggle is on" — see validateField.
  // chattiness never gates (it's always set to a 1–5 default).
  humor: ["humorTypes"],
  vibe: ["toneTags"],
  greetings: ["greetingShapes"],
  emoji: ["emojiPalette"],
  catchphrase: ["signatureMove"],
  voiceExamples: ["voiceExamples"],
  wordBank: ["wordBank"],
  slang: ["slangGlosses"],
  reactions: ["mediaPills"],
  rotLevels: ["rotLevels"],
  review: [],
};

export type PersonaFormErrors = Partial<Record<keyof PersonaFormValues, string>>;

function isBlank(v: string): boolean {
  return v.trim().length === 0;
}

// Splits a free-typed emoji string into individual emoji tokens for the backend
// (emojiPalette is stored as an array). Whitespace separates tokens; within a
// run, trailing modifiers (variation selectors, skin-tone modifiers) and ZWJ
// sequences stay attached to the preceding base, so multi-codepoint emojis
// (🌧️, 👍🏽, 👨‍👩‍👧) aren't shattered. Hermes lacks Intl.Segmenter, so this is a
// small hand-rolled clusterer rather than a true grapheme split.
export function splitEmojis(input: string): string[] {
  const tokens: string[] = [];
  for (const chunk of input.split(/\s+/)) {
    if (!chunk) continue;
    let current = "";
    for (const cp of Array.from(chunk)) {
      const code = cp.codePointAt(0) ?? 0;
      const isModifier =
        code === 0xfe0f || // emoji variation selector
        code === 0xfe0e || // text variation selector
        code === 0x200d || // zero-width joiner
        (code >= 0x1f3fb && code <= 0x1f3ff); // skin-tone modifiers
      if (current === "") {
        current = cp;
      } else if (isModifier || current.endsWith("‍")) {
        current += cp; // attach a modifier, or continue a ZWJ sequence
      } else {
        tokens.push(current);
        current = cp;
      }
    }
    if (current) tokens.push(current);
  }
  return tokens;
}

// Validates a single field against its required-ness and limits. `required`
// only affects emptiness; over-limit always errors. Returns an error CODE
// (the UI maps codes to localized copy), not user-facing text.
function validateField(
  field: keyof PersonaFormValues,
  values: PersonaFormValues,
  required: boolean,
): string | undefined {
  switch (field) {
    case "displayName":
      if (required && isBlank(values.displayName)) return "required";
      if (values.displayName.length > LIMITS.displayName) return "too_long";
      return undefined;
    case "shortDescription":
      if (required && isBlank(values.shortDescription)) return "required";
      if (values.shortDescription.length > LIMITS.shortDescription) return "too_long";
      return undefined;
    case "identity":
      if (required && isBlank(values.identity)) return "required";
      if (values.identity.length > LIMITS.identity) return "too_long";
      return undefined;
    case "humorTypes":
      // Required unless the bot infers its own humor (autoHumor), mirroring how
      // autoGreet waives the greetings requirement.
      if (required && !values.autoHumor && values.humorTypes.length === 0)
        return "required";
      if (values.humorTypes.length > LIMITS.humorTypesMax) return "too_many";
      return undefined;
    case "rotLevels":
      // The custom intensity dial is all-or-nothing (the backend needs all three
      // blocks). Required unless delegated via autoRotLevels.
      if (
        required &&
        !values.autoRotLevels &&
        !values.rotLevels.every((b) => b.trim().length > 0)
      )
        return "required";
      if (values.rotLevels.some((b) => b.length > LIMITS.rotLevelBody)) return "too_long";
      return undefined;
    case "greetingShapes": {
      // The list input can leave blank rows; count only the filled ones.
      // Required unless the bot generates its own greetings (autoGreet). The
      // `required` flag from the step still gates WHEN this is checked.
      const greetingCount = values.greetingShapes.filter((s) => s.trim().length > 0).length;
      if (required && !values.autoGreet && greetingCount === 0) return "required";
      if (greetingCount > LIMITS.greetingsMax) return "too_many";
      return undefined;
    }
    case "emojiPalette": {
      // Required unless delegated via autoEmoji (mirrors autoHumor/autoGreet).
      const emojis = splitEmojis(values.emojiPalette);
      if (required && !values.autoEmoji && emojis.length === 0) return "required";
      if (emojis.length > LIMITS.emojiMax) return "too_many";
      if (emojis.some((e) => e.length > LIMITS.emoji)) return "too_long";
      return undefined;
    }
    case "toneTags":
      if (required && !values.autoTone && values.toneTags.length === 0) return "required";
      if (values.toneTags.length > LIMITS.toneTagsMax) return "too_many";
      return undefined;
    case "signatureMove":
      if (required && !values.autoSignature && isBlank(values.signatureMove)) return "required";
      if (values.signatureMove.length > LIMITS.signatureMove) return "too_long";
      return undefined;
    case "wordBank":
      // Required minimum: the bank is what gives a persona its own vocabulary,
      // so we ask for a few. Gated by `required` (the word-bank step lists it,
      // and validatePersonaForm runs that step) so the too_few error only
      // attaches there, not on every unrelated step. Counter UI on the step.
      if (required && !values.autoWordBank && values.wordBank.length < LIMITS.wordBankMin)
        return "too_few";
      if (values.wordBank.length > LIMITS.wordBankMax) return "too_many";
      if (values.wordBank.some((w) => w.length > LIMITS.wordBankTerm)) return "too_long";
      return undefined;
    case "humorExampleShapes":
      if (values.humorExampleShapes.length > LIMITS.humorExamplesMax) return "too_many";
      return undefined;
    case "voiceExamples":
      // Required unless delegated: needs at least one COMPLETE pair (both sides).
      if (
        required &&
        !values.autoVoiceExamples &&
        values.voiceExamples.filter(
          (ex) => ex.user.trim().length > 0 && ex.good.trim().length > 0,
        ).length === 0
      )
        return "required";
      if (values.voiceExamples.length > LIMITS.voiceExamplesMax) return "too_many";
      if (
        values.voiceExamples.some(
          (ex) => ex.user.length > LIMITS.voiceUser || ex.good.length > LIMITS.voiceGood,
        )
      )
        return "too_long";
      return undefined;
    case "slangGlosses":
      if (required && !values.autoSlang && isBlank(values.slangGlosses)) return "required";
      if (values.slangGlosses.length > LIMITS.slangGlosses) return "too_long";
      return undefined;
    case "mediaPills":
      // Required unless delegated via autoMedia: pick at least one reaction, or
      // let the bot send its own.
      if (required && !values.autoMedia && values.mediaPills.length === 0) return "required";
      if (values.mediaPills.length > LIMITS.mediaPillsMax) return "too_many";
      return undefined;
    case "mediaLean":
      if (values.mediaLean.length > LIMITS.mediaLean) return "too_long";
      return undefined;
    default:
      return undefined;
  }
}

// Errors for one step: its required fields plus any over-limit present fields.
export function validateStep(
  step: PersonaStep,
  values: PersonaFormValues,
): PersonaFormErrors {
  const errors: PersonaFormErrors = {};
  const required = new Set<keyof PersonaFormValues>(PERSONA_STEP_FIELDS[step]);
  for (const field of Object.keys(values) as (keyof PersonaFormValues)[]) {
    const err = validateField(field, values, required.has(field));
    if (err) errors[field] = err;
  }
  return errors;
}

// Whole-form validation (the publish gate): every step's required fields plus
// all limits. Used as the react-hook-form resolver at submit.
export function validatePersonaForm(values: PersonaFormValues): PersonaFormErrors {
  const errors: PersonaFormErrors = {};
  for (const step of PERSONA_STEPS) {
    Object.assign(errors, validateStep(step, values));
  }
  return errors;
}

export function isPersonaFormValid(values: PersonaFormValues): boolean {
  return Object.keys(validatePersonaForm(values)).length === 0;
}

// react-hook-form custom resolver — no zod needed. Returns the RHF-shaped
// errors (one entry per invalid field, error code as the message the UI maps to
// localized copy) and the values when clean.
export function personaFormResolver(values: PersonaFormValues): {
  values: PersonaFormValues | Record<string, never>;
  errors: Record<string, { type: string; message: string }>;
} {
  const found = validatePersonaForm(values);
  const errors: Record<string, { type: string; message: string }> = {};
  for (const [field, code] of Object.entries(found)) {
    if (code) errors[field] = { type: code, message: code };
  }
  return Object.keys(errors).length > 0
    ? { values: {}, errors }
    : { values, errors };
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// Defensive coercion of an unknown blob (a persisted draft read off disk) into
// a complete PersonaFormValues. Missing/wrong-typed fields fall back to empty,
// so a corrupt or older-shape draft can never crash the creator.
export function normalizePersonaForm(value: unknown): PersonaFormValues {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    displayName: asString(v.displayName),
    shortDescription: asString(v.shortDescription),
    identity: asString(v.identity),
    toneTags: asStringArray(v.toneTags),
    humorTypes: asStringArray(v.humorTypes),
    greetingShapes: asStringArray(v.greetingShapes),
    // Legacy drafts stored emojiPalette as a string[]; coalesce to the string
    // the field now holds so an in-flight draft survives the model change.
    emojiPalette: Array.isArray(v.emojiPalette)
      ? asStringArray(v.emojiPalette).join("")
      : asString(v.emojiPalette),
    chattiness: asChattiness(v.chattiness),
    autoTone: Boolean(v.autoTone),
    autoHumor: Boolean(v.autoHumor),
    autoGreet: Boolean(v.autoGreet),
    autoEmoji: Boolean(v.autoEmoji),
    signatureMove: asString(v.signatureMove),
    autoSignature: Boolean(v.autoSignature),
    wordBank: asStringArray(v.wordBank),
    autoWordBank: Boolean(v.autoWordBank),
    humorExampleShapes: asStringArray(v.humorExampleShapes),
    // New plural shape; migrate an in-flight legacy draft (voiceUser/voiceGood).
    voiceExamples:
      asPairArray(v.voiceExamples).length > 0
        ? asPairArray(v.voiceExamples)
        : asString(v.voiceUser) || asString(v.voiceGood)
          ? [{ user: asString(v.voiceUser), good: asString(v.voiceGood) }]
          : [],
    autoVoiceExamples: Boolean(v.autoVoiceExamples),
    slangGlosses: asString(v.slangGlosses),
    autoSlang: Boolean(v.autoSlang),
    mediaPills: asStringArray(v.mediaPills),
    mediaLean: asString(v.mediaLean),
    autoMedia: Boolean(v.autoMedia),
    rotLevels: asRotLevels(v.rotLevels),
    autoRotLevels: Boolean(v.autoRotLevels),
  };
}

// Coerces an unknown blob into voice-example pairs, dropping anything malformed.
function asPairArray(v: unknown): { user: string; good: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
      return { user: asString(o.user), good: asString(o.good) };
    })
    .filter((p) => p.user.length > 0 || p.good.length > 0);
}

// Inverse of toPersonaSavePayload: rebuilds the editable form values from a
// stored persona `input` blob (the builder edit source persisted in
// user_personas/{id}). Read defensively — the blob comes straight off Firestore
// — so a missing/older-shape field falls back to empty rather than crashing the
// editor. EVERY field in PersonaFormValues must be produced here; a round-trip
// test guards against a future field being forgotten (which would silently wipe
// it on edit-save).
export function personaInputToFormValues(input: unknown): PersonaFormValues {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const asObject = (x: unknown): Record<string, unknown> =>
    x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  const publicConfig = asObject(v.publicConfig);
  const slang = asObject(v.slang);
  const media = asObject(v.media);
  // Prefer the plural shape; fall back to a legacy single voiceExample so an
  // edit of a persona saved under the old schema keeps its example.
  const voiceExamples =
    asPairArray(v.voiceExamples).length > 0
      ? asPairArray(v.voiceExamples)
      : asPairArray(v.voiceExample ? [v.voiceExample] : []);
  return {
    displayName: asString(v.displayName),
    shortDescription: asString(publicConfig.shortDescription),
    identity: asString(v.identity),
    toneTags: asStringArray(publicConfig.toneTags),
    autoTone: Boolean(v.autoTone),
    humorTypes: asStringArray(v.humorTypes),
    greetingShapes: asStringArray(v.greetingShapes),
    autoGreet: Boolean(v.autoGreet),
    // Stored as the backend's string[]; the field edits a space-separated string
    // (splitEmojis re-splits on whitespace, so this round-trips cleanly).
    chattiness: asChattiness(v.chattiness),
    autoHumor: Boolean(v.autoHumor),
    emojiPalette: asStringArray(v.emojiPalette).join(" "),
    autoEmoji: Boolean(v.autoEmoji),
    signatureMove: asString(v.signatureMove),
    autoSignature: Boolean(v.autoSignature),
    wordBank: asStringArray(v.wordBank),
    autoWordBank: Boolean(v.autoWordBank),
    humorExampleShapes: asStringArray(v.humorExampleShapes),
    voiceExamples,
    autoVoiceExamples: Boolean(v.autoVoiceExamples),
    slangGlosses: asString(slang.termGlosses),
    autoSlang: Boolean(v.autoSlang),
    mediaPills: asStringArray(media.pills),
    mediaLean: asString(media.lean),
    autoMedia: Boolean(media.auto),
    rotLevels: asRotLevels(v.rotLevels),
    autoRotLevels: Boolean(v.autoRotLevels),
  };
}

// Rebuilds the editor's picked-reactions tray (name + preview thumbnail) from a
// stored persona `input` blob. Prefers the persisted `media.picks` (name + URL,
// written since the thumbnail fix); for a persona saved before picks existed it
// falls back to `media.pills` (names only) with empty previews — the tray then
// shows text chips, exactly as it did before. Read defensively (straight off
// Firestore): anything malformed is dropped rather than crashing the editor.
export function personaInputToMediaPicks(input: unknown): MediaPickInput[] {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const media = (v.media && typeof v.media === "object" ? v.media : {}) as Record<string, unknown>;
  if (Array.isArray(media.picks)) {
    const picks: MediaPickInput[] = [];
    for (const item of media.picks) {
      const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const name = asString(o.name);
      if (name.length === 0) continue;
      picks.push({ name, previewUrl: asString(o.previewUrl) });
    }
    if (picks.length > 0) return picks;
  }
  return asStringArray(media.pills).map((name) => ({ name, previewUrl: "" }));
}

// Coerces an unknown chattiness value to a valid 1–5 dial, falling back to the
// default so a missing/garbage field never produces an out-of-range slider.
function asChattiness(v: unknown): number {
  return typeof v === "number" && v >= CHATTINESS_MIN && v <= CHATTINESS_MAX
    ? Math.round(v)
    : CHATTINESS_DEFAULT;
}

// Coerces an unknown blob into exactly three Rot Level block strings (the form
// always holds three; absent/short → padded with empties).
function asRotLevels(v: unknown): string[] {
  const arr = asStringArray(v);
  return [arr[0] ?? "", arr[1] ?? "", arr[2] ?? ""];
}

// A picked reaction WITH its Klipy preview URL. The same shape as the draft's
// MediaPick, redeclared here (not imported) to avoid a domain import cycle
// (personaDrafts imports this module). Persisted as `media.picks` purely so the
// editor can re-render real thumbnails — the prompt only ever uses the names.
export type MediaPickInput = { name: string; previewUrl: string };

// The persona payload sent as savePersona's `persona` arg. Drops empty
// optionals so the strict backend schema accepts it (no empty strings/arrays
// where it expects an absent field). The avatar is sent separately.
export type PersonaSavePayload = {
  displayName: string;
  identity: string;
  // Omitted when at the default (the backend renders the default wording).
  chattiness?: number;
  greetingShapes: string[];
  autoGreet?: boolean;
  // Omitted when autoHumor is on (mirrors how autoWordBank omits wordBank).
  humorTypes?: string[];
  humorExampleShapes?: string[];
  autoHumor?: boolean;
  emojiPalette?: string[];
  // "Let the bot decide" flags (sent only when ON). No prompt effect — stored on
  // the input so the builder reflects the choice on edit. Mirrors autoWordBank.
  autoTone?: boolean;
  autoEmoji?: boolean;
  autoSignature?: boolean;
  autoVoiceExamples?: boolean;
  autoSlang?: boolean;
  autoRotLevels?: boolean;
  publicConfig: { shortDescription: string; toneTags: string[] };
  voiceExamples?: { user: string; good: string }[];
  slang?: { termGlosses: string };
  signatureMove?: string;
  wordBank?: string[];
  autoWordBank?: boolean;
  media?: { pills?: string[]; picks?: MediaPickInput[]; lean?: string; auto?: boolean };
  // The persona's own three Rot Level block bodies; sent only when all three are
  // authored. Absent → the backend's generic default dial.
  rotLevels?: string[];
};

export function toPersonaSavePayload(
  values: PersonaFormValues,
  // The picked reactions with their preview URLs (from the creator session). When
  // present, persisted as `media.picks` so the editor can re-render thumbnails;
  // the pill NAMES (values.mediaPills) still drive the prompt. Only picks whose
  // name survives in mediaPills are kept, so the two can't drift.
  mediaPicks?: MediaPickInput[],
): PersonaSavePayload {
  const payload: PersonaSavePayload = {
    displayName: values.displayName.trim(),
    identity: values.identity.trim(),
    // Drop blank rows the list input may carry; trim the rest.
    greetingShapes: values.greetingShapes.map((s) => s.trim()).filter(Boolean),
    autoGreet: values.autoGreet,
    publicConfig: {
      shortDescription: values.shortDescription.trim(),
      // When the bot picks its own vibe, send no tags (and the flag below).
      toneTags: values.autoTone ? [] : values.toneTags,
    },
  };
  if (values.autoTone) payload.autoTone = true;
  // When the bot infers its own humor, send the flag and NO humor types (the
  // section drops server-side). Otherwise send the chips + example shapes.
  if (values.autoHumor) {
    payload.autoHumor = true;
  } else {
    payload.humorTypes = values.humorTypes;
    // Backend requires >= 1 example when humor is authored; templates seed one,
    // but fall back to a neutral line so a hand-cleared field can't fail publish.
    payload.humorExampleShapes =
      values.humorExampleShapes.length > 0
        ? values.humorExampleShapes
        : ["keeps it short and lands the joke"];
  }
  // Only send the dial when it's off the default (the backend renders the
  // default wording when it's absent).
  if (values.chattiness !== CHATTINESS_DEFAULT) payload.chattiness = values.chattiness;
  // The persona's own dial — sent only when all three blocks are authored.
  // Each "let the bot decide" optional below sends EITHER its flag (when on) OR
  // its authored value (when off) — never both — mirroring autoWordBank, so the
  // edit round-trip reflects exactly what the user chose.
  const rot = values.rotLevels.map((b) => b.trim());
  if (values.autoRotLevels) {
    payload.autoRotLevels = true;
  } else if (rot.length === 3 && rot.every((b) => b.length > 0)) {
    payload.rotLevels = rot;
  }
  // Emojis are optional: only include the key when the user actually entered
  // some, so the strict backend never sees an empty array.
  const emojis = splitEmojis(values.emojiPalette).slice(0, LIMITS.emojiMax);
  if (values.autoEmoji) {
    payload.autoEmoji = true;
  } else if (emojis.length > 0) {
    payload.emojiPalette = emojis;
  }
  // Only complete pairs (both sides filled) are sent, capped to the max.
  const voiceExamples = values.voiceExamples
    .map((ex) => ({ user: ex.user.trim(), good: ex.good.trim() }))
    .filter((ex) => ex.user.length > 0 && ex.good.length > 0)
    .slice(0, LIMITS.voiceExamplesMax);
  if (values.autoVoiceExamples) {
    payload.autoVoiceExamples = true;
  } else if (voiceExamples.length > 0) {
    payload.voiceExamples = voiceExamples;
  }
  if (values.autoSlang) {
    payload.autoSlang = true;
  } else if (!isBlank(values.slangGlosses)) {
    payload.slang = { termGlosses: values.slangGlosses.trim() };
  }
  if (values.autoSignature) {
    payload.autoSignature = true;
  } else if (!isBlank(values.signatureMove)) {
    payload.signatureMove = values.signatureMove.trim();
  }
  // When the bot uses its own words, send the flag and NO wordBank (the section
  // drops server-side). Otherwise send the chips when there are any.
  if (values.autoWordBank) {
    payload.autoWordBank = true;
  } else if (values.wordBank.length > 0) {
    payload.wordBank = values.wordBank;
  }
  if (values.mediaPills.length > 0 || !isBlank(values.mediaLean) || values.autoMedia) {
    // Keep picks in lockstep with the names actually saved (drop any pick whose
    // pill was removed), so the stored sidecar can never name a search the
    // prompt won't use.
    const names = new Set(values.mediaPills);
    const picks = (mediaPicks ?? []).filter((p) => names.has(p.name));
    payload.media = {
      ...(values.mediaPills.length > 0 ? { pills: values.mediaPills } : {}),
      ...(picks.length > 0 ? { picks } : {}),
      ...(!isBlank(values.mediaLean) ? { lean: values.mediaLean.trim() } : {}),
      ...(values.autoMedia ? { auto: true } : {}),
    };
  }
  return payload;
}
