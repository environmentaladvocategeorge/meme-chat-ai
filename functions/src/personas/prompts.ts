import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { asFragmentedPrompt, assembleFragments } from "./fragments";
import type { Persona, PersonaPrompt, PlatformPrompt } from "./types";
import {
  isUserPersonaDoc,
  isUserPersonaId,
  toResolvedPersonaForStream,
} from "./userPersonas";

// Backend identifiers used to look up the ACTIVE prompts in Firestore. The
// prompt text itself lives in Firestore (collections `platform_prompts` /
// `persona_prompts`) as fragments — Firestore is the single source of truth;
// there are no code-side fallback prompts. A missing/malformed doc throws.
export const PLATFORM_GUARDRAILS_KEY = "platform_guardrails";
export const DEFAULT_PERSONA_ID = "brainrot_bot_default";
// Key for the nano "media decider" prompt (platform_prompts collection). This
// small prompt drives the cheap pre-step that decides whether a turn warrants a
// reaction GIF/meme and picks the search term, so the main (mini) reply never
// has to make a tool round-trip.
export const MEDIA_DECIDER_KEY = "media_decider";

export type ResolvedPersonaForStream = {
  persona: Persona;
  personaPrompt: PersonaPrompt;
};

export type BuiltSystemPromptForStream = {
  systemPrompt: string;
  persona: Pick<Persona, "id" | "name" | "slug" | "publicConfig">;
};

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPersona(data: DocumentData | undefined): data is Persona {
  return (
    isString(data?.id) &&
    isString(data?.name) &&
    isString(data?.slug) &&
    isString(data?.description) &&
    typeof data?.isDefault === "boolean" &&
    typeof data?.isEnabled === "boolean" &&
    isString(data?.addedBy) &&
    typeof data?.publicConfig === "object" &&
    data?.publicConfig !== null &&
    isString(data.publicConfig.displayName) &&
    isString(data.publicConfig.shortDescription) &&
    isString(data.publicConfig.avatarKey) &&
    Array.isArray(data.publicConfig.toneTags)
  );
}

function isPersonaPrompt(data: DocumentData | undefined): data is PersonaPrompt {
  return (
    isString(data?.id) &&
    isString(data?.personaId) &&
    isString(data?.name) &&
    isString(data?.version) &&
    asFragmentedPrompt(data?.fragments) !== null &&
    typeof data?.isActive === "boolean" &&
    isString(data?.addedBy) &&
    isString(data?.notes) &&
    // Optional media-decider config — absent is fine (default decider, no
    // notes), but a malformed value rejects the doc like any other field.
    (data?.mediaDeciderKey == null || isString(data.mediaDeciderKey)) &&
    (data?.mediaNotes == null || isString(data.mediaNotes))
  );
}

function isPlatformPrompt(data: DocumentData | undefined): data is PlatformPrompt {
  return (
    isString(data?.id) &&
    isString(data?.name) &&
    isString(data?.key) &&
    isString(data?.version) &&
    asFragmentedPrompt(data?.fragments) !== null &&
    typeof data?.isActive === "boolean" &&
    isString(data?.addedBy) &&
    isString(data?.notes)
  );
}

export async function getActivePlatformPrompt(
  key: string,
): Promise<PlatformPrompt | null> {
  const snap = await getFirestore()
    .collection("platform_prompts")
    .where("key", "==", key)
    .where("isActive", "==", true)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  const data = snap.docs[0]?.data();
  return isPlatformPrompt(data) ? data : null;
}

export async function getDefaultPersona(): Promise<Persona | null> {
  const snap = await getFirestore()
    .collection("personas")
    .where("isDefault", "==", true)
    .where("isEnabled", "==", true)
    .limit(1)
    .get();

  const data = snap.docs[0]?.data();
  if (isPersona(data)) return data;

  return getPersonaById(DEFAULT_PERSONA_ID);
}

export async function getPersonaById(personaId: string): Promise<Persona | null> {
  const snap = await getFirestore().collection("personas").doc(personaId).get();
  const data = snap.data();
  return isPersona(data) ? data : null;
}

export async function getActivePersonaPrompt(
  personaId: string,
): Promise<PersonaPrompt | null> {
  const snap = await getFirestore()
    .collection("persona_prompts")
    .where("personaId", "==", personaId)
    .where("isActive", "==", true)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  const data = snap.docs[0]?.data();
  return isPersonaPrompt(data) ? data : null;
}

// Reads a user-built persona, honoring it only for its owner: anything else —
// missing doc, malformed doc, disabled, foreign/absent requester — returns
// null so the caller falls back. Never throws for a bad id: a stale client
// pointing at a deleted persona must keep chatting as the default bot.
async function getUserPersonaForStream(
  personaId: string,
  requesterUid?: string,
): Promise<ResolvedPersonaForStream | null> {
  if (!requesterUid) return null;
  const snap = await getFirestore().collection("user_personas").doc(personaId).get();
  const data = snap.data();
  if (!isUserPersonaDoc(data)) return null;
  if (data.ownerUid !== requesterUid || !data.isEnabled) return null;
  return toResolvedPersonaForStream(data);
}

// Resolves the persona + its active prompt for a stream turn. An unknown or
// disabled personaId falls back to the default persona; a missing persona or
// prompt doc throws — Firestore is the single source of truth.
//
// A `user_`-prefixed id resolves from user_personas instead and is honored
// only when requesterUid owns it (and it's enabled) — the prefix is
// authoritative, so a user_ id never resolves from the first-party
// collections. Every rejection silently falls back to the default persona,
// matching the first-party fallback philosophy.
export async function resolvePersonaForStream(
  inputPersonaId?: string,
  requesterUid?: string,
): Promise<ResolvedPersonaForStream> {
  let persona: Persona | null = null;

  if (inputPersonaId && isUserPersonaId(inputPersonaId)) {
    const userPersona = await getUserPersonaForStream(inputPersonaId, requesterUid);
    if (userPersona) return userPersona;
  } else if (inputPersonaId) {
    const requestedPersona = await getPersonaById(inputPersonaId);
    if (requestedPersona?.isEnabled) {
      persona = requestedPersona;
    }
  }

  if (!persona) {
    const defaultPersona = await getDefaultPersona();
    persona = defaultPersona?.isEnabled ? defaultPersona : null;
  }

  if (!persona) {
    throw new Error("[personas] no enabled persona found in Firestore");
  }

  const personaPrompt = await getActivePersonaPrompt(persona.id);
  if (!personaPrompt) {
    throw new Error(
      `[personas] no active persona prompt in Firestore for ${persona.id}`,
    );
  }

  return { persona, personaPrompt };
}

// How the active Rot Level nudges the media decider: a higher dial means lean
// toward attaching a reaction more often. Kept terse — the decider only needs a
// frequency nudge, not the full tone block the persona prompt gets.
function deciderRotLine(level: number): string {
  const clamped = Math.min(Math.max(Math.round(level), 1), 3);
  const lean =
    clamped >= 3
      ? "very generous — attach a reaction on almost every casual turn"
      : clamped === 2
        ? "generous — attach a reaction on a good share of casual turns, but not every one"
        : "sparing — attach a reaction only when it clearly lands";
  return `Current rot level: ${clamped}/3. Media frequency should be ${lean}. (Serious/sensitive/crisis turns always get no media regardless of the dial.)`;
}

// Assembles the nano media-decider system prompt: the media-specific guardrails
// (the platform_guardrails record's `mediaContent` field — decider-tuned
// language, NOT the persona guardrails) + the decider fragments + the dynamic
// tail (persona media notes, then the rot-level frequency nudge). The decider
// is unaffected by the emoji toggle, so emojisEnabled is always true here.
//
// Persona awareness rides the resolved persona prompt's optional fields:
// - mediaDeciderKey picks WHICH decider prompt (a platform_prompts key); an
//   unknown/inactive key silently falls back to the global default, mirroring
//   resolvePersonaForStream's fallback philosophy.
// - mediaNotes (pills/lean) appends as a dynamic suffix BEFORE the rot line —
//   never into the decider body, so the shared prefix (guardrails + decider
//   fragments) stays one globally cached block across all personas.
export async function buildMediaDeciderPrompt(
  levelOfRot = 2,
  personaPrompt?: Pick<PersonaPrompt, "mediaDeciderKey" | "mediaNotes">,
): Promise<string> {
  const deciderKey = personaPrompt?.mediaDeciderKey;
  const [platformPrompt, personaDecider] = await Promise.all([
    getActivePlatformPrompt(PLATFORM_GUARDRAILS_KEY),
    getActivePlatformPrompt(deciderKey ?? MEDIA_DECIDER_KEY),
  ]);
  const deciderPrompt =
    personaDecider ??
    (deciderKey ? await getActivePlatformPrompt(MEDIA_DECIDER_KEY) : null);
  if (!platformPrompt || !isString(platformPrompt.mediaContent)) {
    throw new Error(
      "[personas] platform_guardrails mediaContent missing in Firestore",
    );
  }
  if (!deciderPrompt) {
    throw new Error("[personas] no active media_decider prompt in Firestore");
  }
  const deciderContent = assembleFragments(deciderPrompt.fragments, {
    level: levelOfRot,
    emojisEnabled: true,
  });
  const mediaNotes = personaPrompt?.mediaNotes;
  const dynamicTail = mediaNotes
    ? `${mediaNotes}\n\n${deciderRotLine(levelOfRot)}`
    : deciderRotLine(levelOfRot);
  return `${platformPrompt.mediaContent}\n\n${deciderContent}\n\n${dynamicTail}`;
}

export async function buildSystemPromptForStream(
  inputPersonaId?: string,
  // The user's Rot Level dial (1–3); resolved by the persona fragments' dynamic
  // rot_level_block. Defaults to 2 ("Rotted").
  levelOfRot = 2,
  // The user's "Respond with emojis" toggle. When false, emoji-gated fragments
  // drop out and emoji-off text variants are used (see ./fragments). Defaults to
  // true so existing callers keep today's behavior.
  respondWithEmojis = true,
  // Already-resolved persona + prompt, when the orchestrator resolved it once
  // for the whole turn (it also feeds the media decider). Skips the internal
  // resolution so the persona docs are never read twice; inputPersonaId is
  // ignored when this is provided.
  preResolved?: ResolvedPersonaForStream,
): Promise<BuiltSystemPromptForStream> {
  const platformPrompt = await getActivePlatformPrompt(PLATFORM_GUARDRAILS_KEY);
  if (!platformPrompt) {
    throw new Error(
      "[personas] no active platform_guardrails prompt in Firestore",
    );
  }

  const { persona, personaPrompt } =
    preResolved ?? (await resolvePersonaForStream(inputPersonaId));
  // NOTE: the per-turn word-bank sample is deliberately NOT part of the system
  // prompt — it varies every turn and would cap the cacheable prefix here. It
  // ships as a post-history note instead (personas/perTurnNote.ts). The result
  // of this function is fully static per (rot level, emoji toggle) variant.
  // (If a stale fragment set still contains a word_bank_sample fragment, it
  // drops out cleanly because no sample is provided in the ctx.)
  const assembleCtx = {
    level: levelOfRot,
    emojisEnabled: respondWithEmojis,
  };
  const platformContent = assembleFragments(platformPrompt.fragments, assembleCtx);
  const personaContent = assembleFragments(personaPrompt.fragments, assembleCtx);

  return {
    systemPrompt: `${platformContent}\n\nActive persona prompt:\n${personaContent}`,
    persona: {
      id: persona.id,
      name: persona.name,
      slug: persona.slug,
      publicConfig: persona.publicConfig,
    },
  };
}
