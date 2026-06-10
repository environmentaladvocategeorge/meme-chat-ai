import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { asFragmentedPrompt, assembleFragments } from "./fragments";
import type { Persona, PersonaPrompt, PlatformPrompt } from "./types";

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
    isString(data?.notes)
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

// Resolves the persona + its active prompt for a stream turn. An unknown or
// disabled personaId falls back to the default persona; a missing persona or
// prompt doc throws — Firestore is the single source of truth.
export async function resolvePersonaForStream(
  inputPersonaId?: string,
): Promise<ResolvedPersonaForStream> {
  let persona: Persona | null = null;

  if (inputPersonaId) {
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
// language, NOT the persona guardrails) + the decider fragments + a rot-level
// frequency nudge. The decider is unaffected by the emoji toggle, so
// emojisEnabled is always true here.
export async function buildMediaDeciderPrompt(
  levelOfRot = 2,
): Promise<string> {
  const [platformPrompt, deciderPrompt] = await Promise.all([
    getActivePlatformPrompt(PLATFORM_GUARDRAILS_KEY),
    getActivePlatformPrompt(MEDIA_DECIDER_KEY),
  ]);
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
  return `${platformPrompt.mediaContent}\n\n${deciderContent}\n\n${deciderRotLine(levelOfRot)}`;
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
): Promise<BuiltSystemPromptForStream> {
  const platformPrompt = await getActivePlatformPrompt(PLATFORM_GUARDRAILS_KEY);
  if (!platformPrompt) {
    throw new Error(
      "[personas] no active platform_guardrails prompt in Firestore",
    );
  }

  const { persona, personaPrompt } = await resolvePersonaForStream(inputPersonaId);
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
