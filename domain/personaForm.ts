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
  mediaPill: 60,
  mediaPillsMax: 8,
  mediaLean: 200,
} as const;

export type PersonaFormValues = {
  displayName: string;
  shortDescription: string;
  identity: string;
  toneTags: string[];
  humorTypes: string[];
  greetingShapes: string[];
  // A free-typed string of emojis (split into the backend's array at payload
  // time). The user just types the ones the bot reaches for.
  emojiPalette: string;
  signatureMove: string;
  // The persona's word bank — words/phrases it reaches for, as chips. Optional.
  wordBank: string[];
  // Advanced / optional.
  humorExampleShapes: string[];
  voiceUser: string;
  voiceGood: string;
  slangGlosses: string;
  mediaPills: string[];
  mediaLean: string;
};

export const EMPTY_PERSONA_FORM: PersonaFormValues = {
  displayName: "",
  shortDescription: "",
  identity: "",
  toneTags: [],
  humorTypes: [],
  greetingShapes: [],
  emojiPalette: "",
  signatureMove: "",
  wordBank: [],
  humorExampleShapes: [],
  voiceUser: "",
  voiceGood: "",
  slangGlosses: "",
  mediaPills: [],
  mediaLean: "",
};

// The wizard's primary steps and the REQUIRED fields each one gates on. The old
// "personality" step asked for too much at once, so it's split into three short
// views: who the bot is, its humor, and its tone. Advanced fields (voice
// example, slang, media, humor examples) are optional and live behind an
// expander on the voice step, so they're not in any step's required set.
export const PERSONA_STEPS = [
  "identity",
  "photo",
  "whoAreThey",
  "humor",
  "tone",
  "voice",
  "wordBank",
  "reactions",
  "review",
] as const;
export type PersonaStep = (typeof PERSONA_STEPS)[number];

export const PERSONA_STEP_FIELDS: Record<PersonaStep, (keyof PersonaFormValues)[]> = {
  identity: ["displayName", "shortDescription"],
  // The avatar is optional and lives on the draft (not the form), so the photo
  // step gates on nothing — Next always proceeds.
  photo: [],
  whoAreThey: ["identity"],
  humor: ["humorTypes"],
  // Tone is optional (over-limit still flags), so nothing gates Next here.
  tone: [],
  voice: ["greetingShapes", "emojiPalette"],
  // The word bank is optional (over-limit still flags), so nothing gates Next.
  wordBank: [],
  // Reaction GIFs/memes are optional and picked from Klipy (capped in the UI),
  // so nothing gates Next here.
  reactions: [],
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
      if (required && values.humorTypes.length === 0) return "required";
      if (values.humorTypes.length > LIMITS.humorTypesMax) return "too_many";
      return undefined;
    case "greetingShapes":
      if (required && values.greetingShapes.length === 0) return "required";
      if (values.greetingShapes.length > LIMITS.greetingsMax) return "too_many";
      return undefined;
    case "emojiPalette": {
      if (required && isBlank(values.emojiPalette)) return "required";
      const emojis = splitEmojis(values.emojiPalette);
      if (emojis.length > LIMITS.emojiMax) return "too_many";
      if (emojis.some((e) => e.length > LIMITS.emoji)) return "too_long";
      return undefined;
    }
    case "toneTags":
      if (values.toneTags.length > LIMITS.toneTagsMax) return "too_many";
      return undefined;
    case "signatureMove":
      if (values.signatureMove.length > LIMITS.signatureMove) return "too_long";
      return undefined;
    case "wordBank":
      if (values.wordBank.length > LIMITS.wordBankMax) return "too_many";
      if (values.wordBank.some((w) => w.length > LIMITS.wordBankTerm)) return "too_long";
      return undefined;
    case "humorExampleShapes":
      if (values.humorExampleShapes.length > LIMITS.humorExamplesMax) return "too_many";
      return undefined;
    case "voiceUser":
      if (values.voiceUser.length > LIMITS.voiceUser) return "too_long";
      return undefined;
    case "voiceGood":
      if (values.voiceGood.length > LIMITS.voiceGood) return "too_long";
      return undefined;
    case "slangGlosses":
      if (values.slangGlosses.length > LIMITS.slangGlosses) return "too_long";
      return undefined;
    case "mediaPills":
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
    signatureMove: asString(v.signatureMove),
    wordBank: asStringArray(v.wordBank),
    humorExampleShapes: asStringArray(v.humorExampleShapes),
    voiceUser: asString(v.voiceUser),
    voiceGood: asString(v.voiceGood),
    slangGlosses: asString(v.slangGlosses),
    mediaPills: asStringArray(v.mediaPills),
    mediaLean: asString(v.mediaLean),
  };
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
  const voice = asObject(v.voiceExample);
  const slang = asObject(v.slang);
  const media = asObject(v.media);
  return {
    displayName: asString(v.displayName),
    shortDescription: asString(publicConfig.shortDescription),
    identity: asString(v.identity),
    toneTags: asStringArray(publicConfig.toneTags),
    humorTypes: asStringArray(v.humorTypes),
    greetingShapes: asStringArray(v.greetingShapes),
    // Stored as the backend's string[]; the field edits a space-separated string
    // (splitEmojis re-splits on whitespace, so this round-trips cleanly).
    emojiPalette: asStringArray(v.emojiPalette).join(" "),
    signatureMove: asString(v.signatureMove),
    wordBank: asStringArray(v.wordBank),
    humorExampleShapes: asStringArray(v.humorExampleShapes),
    voiceUser: asString(voice.user),
    voiceGood: asString(voice.good),
    slangGlosses: asString(slang.termGlosses),
    mediaPills: asStringArray(media.pills),
    mediaLean: asString(media.lean),
  };
}

// The persona payload sent as savePersona's `persona` arg. Drops empty
// optionals so the strict backend schema accepts it (no empty strings/arrays
// where it expects an absent field). The avatar is sent separately.
export type PersonaSavePayload = {
  displayName: string;
  identity: string;
  greetingShapes: string[];
  humorTypes: string[];
  humorExampleShapes: string[];
  emojiPalette: string[];
  publicConfig: { shortDescription: string; toneTags: string[] };
  voiceExample?: { user: string; good: string };
  slang?: { termGlosses: string };
  signatureMove?: string;
  wordBank?: string[];
  media?: { pills?: string[]; lean?: string };
};

export function toPersonaSavePayload(values: PersonaFormValues): PersonaSavePayload {
  const payload: PersonaSavePayload = {
    displayName: values.displayName.trim(),
    identity: values.identity.trim(),
    greetingShapes: values.greetingShapes,
    humorTypes: values.humorTypes,
    // Backend requires >= 1; templates always seed one, but fall back to a
    // neutral line so a hand-cleared advanced field can't make publish fail.
    humorExampleShapes:
      values.humorExampleShapes.length > 0
        ? values.humorExampleShapes
        : ["keeps it short and lands the joke"],
    emojiPalette: splitEmojis(values.emojiPalette).slice(0, LIMITS.emojiMax),
    publicConfig: {
      shortDescription: values.shortDescription.trim(),
      toneTags: values.toneTags,
    },
  };
  if (!isBlank(values.voiceUser) && !isBlank(values.voiceGood)) {
    payload.voiceExample = {
      user: values.voiceUser.trim(),
      good: values.voiceGood.trim(),
    };
  }
  if (!isBlank(values.slangGlosses)) {
    payload.slang = { termGlosses: values.slangGlosses.trim() };
  }
  if (!isBlank(values.signatureMove)) {
    payload.signatureMove = values.signatureMove.trim();
  }
  if (values.wordBank.length > 0) {
    payload.wordBank = values.wordBank;
  }
  if (values.mediaPills.length > 0 || !isBlank(values.mediaLean)) {
    payload.media = {
      ...(values.mediaPills.length > 0 ? { pills: values.mediaPills } : {}),
      ...(!isBlank(values.mediaLean) ? { lean: values.mediaLean.trim() } : {}),
    };
  }
  return payload;
}
