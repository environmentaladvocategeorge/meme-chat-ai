import { logger } from "firebase-functions";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import {
  applyRotLevel,
  BRAINROT_BOT_PERSONA_PROMPT_FALLBACK,
  DEFAULT_PERSONA_ID,
  PLATFORM_GUARDRAILS_FALLBACK,
  PLATFORM_GUARDRAILS_KEY,
} from "./content";
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

export async function buildSystemPromptForStream(
  inputPersonaId?: string,
  // The user's Rot Level dial (1–3); substituted into the persona prompt's
  // {{ROT_LEVEL_BLOCK}} placeholder. Defaults to 2 ("Rotted").
  levelOfRot = 2,
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
  const personaContent = applyRotLevel(personaPrompt.content, levelOfRot);

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
