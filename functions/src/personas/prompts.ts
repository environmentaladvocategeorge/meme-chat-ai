import { logger } from "firebase-functions";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import {
  applyRotLevel,
  BRAINROT_BOT_PERSONA_PROMPT_FALLBACK,
  DEFAULT_PERSONA_ID,
  MEDIA_DECIDER_KEY,
  MEDIA_DECIDER_PROMPT_FALLBACK,
  MEDIA_GUARDRAILS_FALLBACK,
  PLATFORM_GUARDRAILS_FALLBACK,
  PLATFORM_GUARDRAILS_KEY,
} from "./content";
import { asFragmentedPrompt, assembleFragments } from "./fragments";
import type { Persona, PersonaPrompt, PlatformPrompt } from "./types";

export type ResolvedPersonaForStream = {
  persona: Persona;
  personaPrompt: PersonaPrompt;
};

export type BuiltSystemPromptForStream = {
  systemPrompt: string;
  persona: Pick<Persona, "id" | "name" | "slug" | "publicConfig">;
};

function fallbackPersona(): Persona {
  return {
    id: DEFAULT_PERSONA_ID,
    name: "Brainrot Bot",
    slug: "brainrot-bot",
    description:
      "A funny, meme-aware conversational agent that gives real answers with natural internet humor.",
    isDefault: true,
    isEnabled: true,
    addedBy: "backend_fallback",
    publicConfig: {
      displayName: "Brainrot Bot",
      shortDescription: "Helpful answers with meme timing.",
      avatarKey: "brainrot_bot",
      toneTags: ["funny", "meme", "casual", "concise"],
    },
  };
}

function fallbackPersonaPrompt(personaId = DEFAULT_PERSONA_ID): PersonaPrompt {
  return {
    id: `${personaId}_fallback`,
    personaId,
    name: "Brainrot Bot Fallback Prompt",
    version: "fallback",
    content: BRAINROT_BOT_PERSONA_PROMPT_FALLBACK,
    isActive: true,
    addedBy: "backend_fallback",
    notes: "Backend-only fallback used when Firestore persona prompts are unavailable.",
  };
}

function fallbackPlatformPrompt(): PlatformPrompt {
  return {
    id: "platform_guardrails_fallback",
    name: "Platform Guardrails Fallback",
    key: PLATFORM_GUARDRAILS_KEY,
    version: "fallback",
    content: PLATFORM_GUARDRAILS_FALLBACK,
    isActive: true,
    addedBy: "backend_fallback",
    notes: "Backend-only fallback used when Firestore platform prompts are unavailable.",
  };
}

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
    isString(data?.content) &&
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
    isString(data?.content) &&
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

export async function resolvePersonaForStream(
  inputPersonaId?: string,
): Promise<ResolvedPersonaForStream> {
  let persona: Persona | null = null;

  try {
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
  } catch (err) {
    logger.warn("[personas] persona resolution failed; using fallback", { err });
  }

  persona ??= fallbackPersona();

  let personaPrompt: PersonaPrompt | null = null;
  try {
    personaPrompt = await getActivePersonaPrompt(persona.id);
  } catch (err) {
    logger.warn("[personas] persona prompt resolution failed; using fallback", {
      personaId: persona.id,
      err,
    });
  }

  return {
    persona,
    personaPrompt: personaPrompt ?? fallbackPersonaPrompt(persona.id),
  };
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
// language, NOT the persona guardrails) + the decider instructions + a
// rot-level frequency nudge. Mirrors buildSystemPromptForStream's fallback
// behavior so a Firestore hiccup still yields a usable decider.
export async function buildMediaDeciderPrompt(levelOfRot = 2): Promise<string> {
  let platformPrompt: PlatformPrompt | null = null;
  let deciderPrompt: PlatformPrompt | null = null;
  try {
    [platformPrompt, deciderPrompt] = await Promise.all([
      getActivePlatformPrompt(PLATFORM_GUARDRAILS_KEY),
      getActivePlatformPrompt(MEDIA_DECIDER_KEY),
    ]);
  } catch (err) {
    logger.warn("[personas] media decider prompt resolution failed; using fallback", {
      err,
    });
  }
  // The decider uses the `mediaContent` field, NOT `content` (which is the
  // persona path's guardrails). Falls back when the field/doc is absent.
  const guardrails = platformPrompt?.mediaContent ?? MEDIA_GUARDRAILS_FALLBACK;
  // Prefer the fragmented decider body when present + valid; else the legacy
  // monolithic `content`. The decider is unaffected by the emoji toggle, so
  // emojisEnabled is always true here. The rot-level frequency nudge is appended
  // after, exactly as before, so a fragmented assembly stays byte-identical.
  const deciderFragmented = deciderPrompt
    ? asFragmentedPrompt(deciderPrompt.fragments)
    : null;
  const deciderContent = deciderFragmented
    ? assembleFragments(deciderFragmented, { level: levelOfRot, emojisEnabled: true })
    : (deciderPrompt?.content ?? MEDIA_DECIDER_PROMPT_FALLBACK);
  return `${guardrails}\n\n${deciderContent}\n\n${deciderRotLine(levelOfRot)}`;
}

export async function buildSystemPromptForStream(
  inputPersonaId?: string,
  // The user's Rot Level dial (1–3); substituted into the persona prompt's
  // {{ROT_LEVEL_BLOCK}} placeholder. Defaults to 2 ("Rotted").
  levelOfRot = 2,
  // The user's "Respond with emojis" toggle. When false, the rot block's emoji
  // bullet is swapped for a hard "no emojis" directive (see applyRotLevel).
  // Defaults to true so existing callers keep today's behavior.
  respondWithEmojis = true,
): Promise<BuiltSystemPromptForStream> {
  let platformPrompt: PlatformPrompt | null = null;
  try {
    platformPrompt = await getActivePlatformPrompt(PLATFORM_GUARDRAILS_KEY);
  } catch (err) {
    logger.warn("[personas] platform prompt resolution failed; using fallback", {
      err,
    });
  }

  const { persona, personaPrompt } = await resolvePersonaForStream(inputPersonaId);
  const platformContent = platformPrompt?.content ?? fallbackPlatformPrompt().content;
  // Prefer the fragmented persona when present + valid; else assemble the legacy
  // monolithic `content` via applyRotLevel. Both honor the rot level + emoji
  // toggle; for the default (emoji-on) case the two produce byte-identical text
  // (asserted by the fragment-persona migration script).
  const fragmented = asFragmentedPrompt(personaPrompt.fragments);
  const personaContent = fragmented
    ? assembleFragments(fragmented, {
        level: levelOfRot,
        emojisEnabled: respondWithEmojis,
      })
    : applyRotLevel(personaPrompt.content, levelOfRot, respondWithEmojis);

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
