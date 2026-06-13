import { randomBytes } from "crypto";
import type { DocumentData, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import type { PlanId } from "../billing/plans";
import { asFragmentedPrompt, type FragmentedPrompt } from "./fragments";
import type { PersonaSpec } from "./personaSpec";
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

// Hard ceiling on stored personas per user; the free tier gets 1. Enforced at
// save time (count check), never at read time — lowering a cap must not break
// personas users already chat with.
export const MAX_USER_PERSONAS = 10;

export function userPersonaCap(plan: PlanId): number {
  return plan === "free" ? 1 : MAX_USER_PERSONAS;
}

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
    voiceExample: z
      .object({ user: line(300), bad: line(500), good: line(500) })
      .strict(),
    signatureMove: line(200).optional(),
    greetingShapes: z.array(line(120)).min(1).max(6),
    humorTypes: z.array(line(40)).min(1).max(8),
    humorExampleShapes: z.array(line(160)).min(1).max(6),
    slang: z
      .object({ termGlosses: line(1200), usageNotes: line(600) })
      .strict(),
    emojiPalette: z.array(line(8)).min(1).max(20),
    media: z
      .object({
        pills: z.array(line(60)).max(8).optional(),
        lean: line(200).optional(),
      })
      .strict()
      .optional(),
    publicConfig: z
      .object({
        shortDescription: line(160),
        avatarKey: line(64),
        toneTags: z.array(line(24)).max(5),
      })
      .strict(),
  })
  .strict();

export type UserPersonaInput = z.infer<typeof userPersonaInputSchema>;

// Maps a validated builder payload onto the spec the renderer consumes. The id
// is always the server-generated doc id; the first-party-only slots are simply
// never set.
export function toPersonaSpec(personaId: string, input: UserPersonaInput): PersonaSpec {
  const spec: PersonaSpec = {
    id: personaId,
    displayName: input.displayName,
    identity: input.identity,
    voiceExample: input.voiceExample,
    greetingShapes: input.greetingShapes,
    humorTypes: input.humorTypes,
    humorExampleShapes: input.humorExampleShapes,
    slang: input.slang,
    emojiPalette: input.emojiPalette,
  };
  if (input.signatureMove) spec.signatureMove = input.signatureMove;
  if (input.media && ((input.media.pills?.length ?? 0) > 0 || input.media.lean)) {
    spec.media = {
      ...(input.media.pills?.length ? { pills: input.media.pills } : {}),
      ...(input.media.lean ? { lean: input.media.lean } : {}),
    };
  }
  return spec;
}

// The stored shape in user_personas/{id}: the raw input (builder edit source),
// the store-facing public config, and the save-time render (fragments +
// mediaNotes — never mediaDeciderKey; user personas always run the default
// decider machinery).
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
    isNonEmptyString(data.publicConfig.avatarKey) &&
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
    ...(doc.mediaNotes ? { mediaNotes: doc.mediaNotes } : {}),
    isActive: doc.isEnabled,
    addedBy: doc.ownerUid,
    notes: "user persona",
  };
  return { persona, personaPrompt };
}
