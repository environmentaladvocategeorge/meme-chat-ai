import { randomBytes } from "crypto";
import type { DocumentData, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import type { PlanId } from "../billing/plans";
import { asFragmentedPrompt, type FragmentedPrompt } from "./fragments";
import { PERSONA_MEDIA_DECIDER_KEY } from "./personaMediaDeciderPrompt";
import type { PersonaSpec } from "./personaSpec";
import {
  DEFAULT_ROT_EMOJI_LINES,
  DEFAULT_USER_ROT_LEVELS,
  withEmojiPlaceholder,
} from "./rotLevel";
import type { Persona, PersonaPrompt, PersonaPublicConfig } from "./types";

// ── User-built personas ──────────────────────────────────────────────────────
// The persistence shape behind the persona builder. A user persona is the
// user-authorable subset of PersonaSpec (no houseExtras, no lexicalRule, no
// media.deciderKey — those stay first-party by construction: the input schema
// is strict, so they're rejected, not stripped), validated and moderated at
// save time, rendered ONCE through renderPersonaPromptDoc, and stored in
// `user_personas/{id}` alongside the raw input so the builder can re-edit.
//
// Serving rides the existing stream machinery untouched: a stored doc adapts
// into the same { persona, personaPrompt } pair resolvePersonaForStream
// returns for first-party personas. The `user_` id prefix is the cheap
// discriminator the resolver uses to pick the collection — and ownership is
// enforced there (ownerUid must match the requester) before a user persona is
// ever honored.

export const USER_PERSONA_ID_PREFIX = "user_";

// Per-tier ceiling on stored personas, enforced at save time (count check),
// never at read time — lowering a cap must not break personas users already
// chat with. The top tier (power) is UNLIMITED: Infinity makes the save-time
// `owned.size >= cap` check simply never trip.
const USER_PERSONA_CAP: Record<PlanId, number> = {
  free: 3,
  basic: 10,
  plus: 100,
  power: Number.POSITIVE_INFINITY,
};
// The largest FINITE per-plan cap, for anywhere code needs a concrete upper
// bound (the unlimited power tier can't serve as one).
export const MAX_USER_PERSONAS = USER_PERSONA_CAP.plus;

export function isUserPersonaCapUnlimited(plan: PlanId): boolean {
  return !Number.isFinite(USER_PERSONA_CAP[plan] ?? USER_PERSONA_CAP.free);
}

export function userPersonaCap(plan: PlanId): number {
  return USER_PERSONA_CAP[plan] ?? USER_PERSONA_CAP.free;
}

// Word-bank caps (mirrored in domain/personaForm.ts LIMITS — a parity test
// pins them). The bank is bounded by count + per-term length instead of the old
// global rotating sampler; keeps the rendered WORD BANK section's token cost
// predictable.
export const WORD_BANK_MAX = 20;
export const WORD_BANK_TERM_MAX = 60;

export function isUserPersonaId(id: string): boolean {
  return id.startsWith(USER_PERSONA_ID_PREFIX);
}

// Doc ids embed the owner uid (debuggability: a flagged doc names its owner on
// sight) plus a random suffix so deletes/recreates never collide.
export function newUserPersonaId(uid: string): string {
  return `${USER_PERSONA_ID_PREFIX}${uid}_${randomBytes(4).toString("hex")}`;
}

const line = (max: number) => z.string().trim().min(1).max(max);

// The builder payload: every user-authorable PersonaSpec slot, strictly — an
// unknown key anywhere is a validation error, which is what keeps the
// first-party-only machinery structurally unreachable from the client.
export const userPersonaInputSchema = z
  .object({
    displayName: line(40),
    identity: line(600),
    // Only POSITIVE examples are user-authored (someone says X, the persona
    // replies Y). The persona-dropped "bad" example is seeded server-side
    // (toPersonaSpec). `voiceExamples` (plural, up to 5) is the current shape;
    // `voiceExample` (singular) is still accepted from older clients that
    // haven't updated — toPersonaSpec coalesces the two. Both optional.
    voiceExample: z
      .object({ user: line(300), good: line(500) })
      .strict()
      .optional(),
    voiceExamples: z
      .array(z.object({ user: line(300), good: line(500) }).strict())
      .max(5)
      .optional(),
    signatureMove: line(200).optional(),
    // Reply-length dial (1 = curt … 5 = chatty). Optional; absent renders at the
    // balanced middle, byte-identical to the original fixed wording.
    chattiness: z.number().int().min(1).max(5).optional(),
    // Greetings are optional when autoGreet is on (the persona improvises its
    // own); a refine below requires at least one shape otherwise.
    greetingShapes: z.array(line(120)).max(6).optional(),
    autoGreet: z.boolean().optional(),
    // Humor is optional when autoHumor is on (the persona infers its own humor
    // from its identity); a refine below requires at least one type otherwise.
    humorTypes: z.array(line(40)).max(8).optional(),
    humorExampleShapes: z.array(line(160)).max(6).optional(),
    autoHumor: z.boolean().optional(),
    // The persona's slang glossary. `terms` is the current shape (term → what it
    // means, the two-pill builder); `termGlosses` is the legacy single free-text
    // field, still accepted from older clients. toPersonaSpec coalesces the two.
    // The usage-boundary (what may roast what) is a SAFETY control, never
    // user-authored — it's a fixed platform default applied in toPersonaSpec.
    slang: z
      .object({
        termGlosses: line(1200).optional(),
        terms: z
          .array(z.object({ term: line(60), meaning: line(200) }).strict())
          .max(24)
          .optional(),
      })
      .strict()
      .optional(),
    // The persona's own three Rot Level block bodies (index 0 = level 1, …). The
    // per-level emoji density + the TONE PRIORITY note are house machinery, added
    // in toPersonaSpec. Absent → the generic default dial (DEFAULT_USER_ROT_LEVELS).
    rotLevels: z.array(line(1500)).length(3).optional(),
    // Optional: a persona can ship with no emoji palette (the EMOJI section
    // then drops out of the rendered prompt). Older clients always send >= 1.
    emojiPalette: z.array(line(8)).max(20).optional(),
    // The persona's vocabulary chips (optional). Bounded by count + per-term
    // length so the rendered WORD BANK section stays cheap.
    wordBank: z.array(line(WORD_BANK_TERM_MAX)).max(WORD_BANK_MAX).optional(),
    // "Let the bot use its own words" toggle — when on the client sends no
    // wordBank (the WORD BANK section drops, so the bot uses natural vocabulary).
    // Stored on the input for edit round-trip; no render effect of its own.
    autoWordBank: z.boolean().optional(),
    // "Let the bot decide" toggles for the remaining optional sections. Like
    // autoWordBank these carry NO render effect (toPersonaSpec ignores them) —
    // they're stored purely so the builder reflects the choice on edit. When one
    // is on, the client omits that section's value (toneTags/emojiPalette/etc.).
    autoTone: z.boolean().optional(),
    autoEmoji: z.boolean().optional(),
    autoSignature: z.boolean().optional(),
    autoVoiceExamples: z.boolean().optional(),
    autoSlang: z.boolean().optional(),
    autoRotLevels: z.boolean().optional(),
    media: z
      .object({
        pills: z.array(line(60)).max(10).optional(),
        // Edit-UI sidecar: the picked reactions WITH their Klipy preview URL, so
        // the builder can re-render real thumbnails on edit (pills carry only the
        // search NAME). Purely cosmetic — toPersonaSpec ignores it, so it never
        // reaches the prompt or moderation. Bounded like pills (≤10) + a URL cap.
        picks: z
          .array(
            z
              .object({ name: line(60), previewUrl: z.string().trim().max(1000) })
              .strict(),
          )
          .max(10)
          .optional(),
        lean: line(200).optional(),
        // "Let the bot send its own GIFs" toggle (mirrors autoGreet).
        auto: z.boolean().optional(),
      })
      .strict()
      .optional(),
    publicConfig: z
      .object({
        shortDescription: line(160),
        // Preset-avatar key (legacy/first-party). User personas use an uploaded
        // avatar instead (savePersona's `avatar` param → publicConfig.avatarUrl),
        // so this is optional.
        avatarKey: line(64).optional(),
        toneTags: z.array(line(24)).max(5),
      })
      .strict(),
  })
  .strict()
  // A persona needs at least one greeting shape unless it's allowed to generate
  // its own. (Belt-and-suspenders: the builder enforces the same rule.)
  .superRefine((val, ctx) => {
    if (!val.autoGreet && (val.greetingShapes?.length ?? 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["greetingShapes"],
        message: "At least one greeting is required unless autoGreet is on.",
      });
    }
    if (!val.autoHumor && (val.humorTypes?.length ?? 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["humorTypes"],
        message: "At least one humor type is required unless autoHumor is on.",
      });
    }
  });

export type UserPersonaInput = z.infer<typeof userPersonaInputSchema>;

// The persona-dropped "bad" example, seeded for every user persona. It shows
// the SHAPE of the failure the voice contract warns against (flat, corporate,
// enumerated, offering follow-ups), which is persona-independent — so one
// generic example works regardless of the persona's voice.
export const DEFAULT_VOICE_BAD =
  "Certainly! Here's a clear, step-by-step breakdown. First, consider the context. Second, weigh your options. Let me know if you'd like me to elaborate.";

// Seeded when the user authors no positive example (rare — templates provide
// one). Deliberately bland so a persona without its own example still renders.
const DEFAULT_VOICE_EXAMPLE = {
  user: "explain this to me",
  good: "ok real talk, here's the short version",
};

// The fixed platform usage-boundary for user personas. NEVER user-authored: it
// gates what the persona's slang may target. Persona-neutral restatement of the
// house stance (playful roasting of choices/vibes is fine; sexualizing an
// identifiable person is not).
export const PLATFORM_SLANG_USAGE_NOTES =
  "Slang can roast choices, code, situations, outfits, vibes, screenshots, or the user when the context is playful. Explain internet or sexual slang abstractly as culture; never turn it into sexual comments about an identifiable person.";

// Builds the slang gloss paragraph the renderer consumes. Prefers the structured
// two-pill `terms` (term → meaning), formatted to match the existing gloss style
// (`"term" = meaning`, "; "-joined); falls back to the legacy free-text field.
function slangTermGlosses(slang: UserPersonaInput["slang"]): string {
  const terms = (slang?.terms ?? []).filter(
    (t) => t.term.trim().length > 0 && t.meaning.trim().length > 0,
  );
  if (terms.length > 0) {
    return terms.map((t) => `"${t.term.trim()}" = ${t.meaning.trim()}`).join("; ");
  }
  return slang?.termGlosses ?? "";
}

// Maps a validated builder payload onto the spec the renderer consumes. The id
// is always the server-generated doc id; the first-party-only slots are simply
// never set. The seeded fields (voiceExample.bad, slang.usageNotes) are filled
// here, never from user input.
export function toPersonaSpec(personaId: string, input: UserPersonaInput): PersonaSpec {
  // Coalesce the plural (current) and singular (legacy client) example shapes
  // into one list, then fall back to the seeded default when the user authored
  // none. The first drives the bad/good voice contract; the rest render after.
  const examples =
    input.voiceExamples && input.voiceExamples.length > 0
      ? input.voiceExamples
      : input.voiceExample
        ? [input.voiceExample]
        : [DEFAULT_VOICE_EXAMPLE];
  const [primary, ...extras] = examples;
  const spec: PersonaSpec = {
    id: personaId,
    displayName: input.displayName,
    identity: input.identity,
    voiceExample: { user: primary.user, bad: DEFAULT_VOICE_BAD, good: primary.good },
    greetingShapes: input.greetingShapes ?? [],
    humorTypes: input.humorTypes ?? [],
    humorExampleShapes: input.humorExampleShapes ?? [],
    slang: {
      termGlosses: slangTermGlosses(input.slang),
      usageNotes: PLATFORM_SLANG_USAGE_NOTES,
    },
    emojiPalette: input.emojiPalette ?? [],
    // Every user persona carries an explicit Rot Level dial: its own authored
    // blocks, or the generic default — never the built-in Brainrot dial.
    rotLevels: input.rotLevels
      ? {
          blocks: {
            1: withEmojiPlaceholder(input.rotLevels[0]),
            2: withEmojiPlaceholder(input.rotLevels[1]),
            3: withEmojiPlaceholder(input.rotLevels[2]),
          },
          emojiLines: DEFAULT_ROT_EMOJI_LINES,
        }
      : DEFAULT_USER_ROT_LEVELS,
  };
  if (extras.length > 0) spec.voiceExtraExamples = extras;
  if (input.autoGreet) spec.autoGreet = true;
  if (typeof input.chattiness === "number") spec.chattiness = input.chattiness;
  if (input.signatureMove) spec.signatureMove = input.signatureMove;
  if (input.wordBank && input.wordBank.length > 0) spec.wordBank = input.wordBank;
  if (
    input.media &&
    ((input.media.pills?.length ?? 0) > 0 || input.media.lean || input.media.auto)
  ) {
    spec.media = {
      ...(input.media.pills?.length ? { pills: input.media.pills } : {}),
      ...(input.media.lean ? { lean: input.media.lean } : {}),
      ...(input.media.auto ? { auto: true } : {}),
    };
  }
  return spec;
}

// The stored shape in user_personas/{id}: the raw input (builder edit source),
// the store-facing public config, and the save-time render (fragments +
// mediaNotes). mediaDeciderKey is NOT stored — it's applied at resolution time
// (toResolvedPersonaForStream sets PERSONA_MEDIA_DECIDER_KEY for every user
// persona), so it stays first-party even though the input schema forbids it.
export type UserPersonaDoc = {
  id: string;
  ownerUid: string;
  input: UserPersonaInput;
  publicConfig: PersonaPublicConfig;
  fragments: FragmentedPrompt;
  mediaNotes?: string;
  isEnabled: boolean;
  // The save-time verdict that admitted this persona: overall certainty and
  // the gates that ran. Audit metadata only — serving never re-moderates.
  moderation: { certainty: number; gates: string[] };
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// Validates a candidate user_personas doc read from Firestore. Shallow on
// `input` (the builder re-validates through the schema on edit) but strict on
// every field the stream path serves from.
export function isUserPersonaDoc(data: DocumentData | undefined): data is UserPersonaDoc {
  return (
    isNonEmptyString(data?.id) &&
    isUserPersonaId(data.id) &&
    isNonEmptyString(data?.ownerUid) &&
    typeof data?.input === "object" &&
    data?.input !== null &&
    typeof data?.publicConfig === "object" &&
    data?.publicConfig !== null &&
    isNonEmptyString(data.publicConfig.displayName) &&
    isNonEmptyString(data.publicConfig.shortDescription) &&
    // Avatar is optional (uploaded → avatarUrl, or none → client monogram).
    (data.publicConfig.avatarUrl == null ||
      isNonEmptyString(data.publicConfig.avatarUrl)) &&
    Array.isArray(data.publicConfig.toneTags) &&
    asFragmentedPrompt(data?.fragments) !== null &&
    (data?.mediaNotes == null || isNonEmptyString(data.mediaNotes)) &&
    typeof data?.isEnabled === "boolean" &&
    typeof data?.moderation === "object" &&
    data?.moderation !== null
  );
}

// Adapts a stored user persona into the exact pair the stream pipeline already
// consumes — buildSystemPromptForStream and buildMediaDeciderPrompt never
// learn user personas exist.
export function toResolvedPersonaForStream(doc: UserPersonaDoc): {
  persona: Persona;
  personaPrompt: PersonaPrompt;
} {
  const persona: Persona = {
    id: doc.id,
    name: doc.publicConfig.displayName,
    slug: doc.id,
    description: doc.publicConfig.shortDescription,
    isDefault: false,
    isEnabled: doc.isEnabled,
    addedBy: doc.ownerUid,
    publicConfig: doc.publicConfig,
  };
  const personaPrompt: PersonaPrompt = {
    id: doc.id,
    personaId: doc.id,
    name: doc.publicConfig.displayName,
    version: "user",
    fragments: doc.fragments,
    // Every user persona runs the persona-tuned media decider: favorites-first,
    // no brainrot bank / brainrot rung (see personaMediaDeciderPrompt.ts). Set
    // here in resolution rather than stored on the doc — it's first-party by
    // construction (the input schema rejects media.deciderKey), and it falls
    // back to the brainrot default if that decider doc isn't live yet.
    mediaDeciderKey: PERSONA_MEDIA_DECIDER_KEY,
    ...(doc.mediaNotes ? { mediaNotes: doc.mediaNotes } : {}),
    isActive: doc.isEnabled,
    addedBy: doc.ownerUid,
    notes: "user persona",
  };
  return { persona, personaPrompt };
}
