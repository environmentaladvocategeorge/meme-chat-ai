import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import type { PlanId } from "../billing/plans";
import { loadEntitlement } from "../entitlement/loadEntitlement";
import { logFlaggedContent } from "../moderation/logFlaggedContent";
import {
  PersonaModerationService,
  type PersonaModerationInput,
  type PersonaModerationResult,
} from "../moderation/personaModeration";
import { renderPersonaPromptDoc } from "./personaSpec";
import type { PersonaPublicConfig } from "./types";
import {
  isUserPersonaId,
  newUserPersonaId,
  toPersonaSpec,
  userPersonaCap,
  userPersonaInputSchema,
} from "./userPersonas";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// ── savePersona / deletePersona ──────────────────────────────────────────────
// The only write paths into user_personas (firestore.rules deny all client
// writes; clients only read their own docs). A save is: validate → cap check →
// moderate (three fail-closed gates, see ../moderation/personaModeration) →
// render once → write. Saves are NOT rate-limited per day by design (Jorge's
// call: the cap on stored personas is the limit; moderation cost is absorbed
// as system margin) — the count cap still runs before moderation so a full
// shelf never burns an API call.

const requestSchema = z
  .object({
    persona: userPersonaInputSchema,
    // Present = overwrite that persona in place (must be owned); absent =
    // create a new one under the plan's cap.
    personaId: z.string().trim().min(1).max(128).optional(),
    // A just-uploaded avatar (client uploaded the object to its own
    // personaAvatars/{uid}/… path and passes the download URL + path). The URL
    // is moderated with the text; the path is verified to belong to the caller
    // and stored for later deletion. Absent = no avatar (client renders a
    // monogram).
    avatar: z
      .object({ url: z.string().url().max(2048), path: z.string().min(1).max(512) })
      .strict()
      .optional(),
    // Edit-only: clear the persona's stored avatar (back to a client monogram).
    // Ignored on create and when a new `avatar` is supplied (the upload wins).
    removeAvatar: z.boolean().optional(),
  })
  .strict();

export type SavePersonaResult = {
  personaId: string;
  publicConfig: PersonaPublicConfig;
  // The moderation pipeline's confidence in admitting the persona (0–1).
  certainty: number;
};

// Injectable seams: tests swap the db and the moderation call; production
// passes Firestore + a PersonaModerationService bound to the OpenAI key.
export type SavePersonaDeps = {
  db: ReturnType<typeof getFirestore>;
  moderate: (
    input: PersonaModerationInput,
    imageUrl?: string,
  ) => Promise<PersonaModerationResult>;
  // Best-effort Storage cleanup of an orphaned avatar object (the old one when
  // an edit replaces or removes it). Injected so the core stays testable; the
  // callable provides the real deleter. Absent → orphan cleanup is skipped.
  deleteObject?: (path: string) => Promise<void>;
};

export async function savePersonaForUser(
  uid: string,
  plan: PlanId,
  rawData: unknown,
  deps: SavePersonaDeps,
): Promise<SavePersonaResult> {
  const parsed = requestSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "invalid_request");
  }
  const input = parsed.data.persona;
  const avatar = parsed.data.avatar;
  // Removal only matters on an edit with no replacement upload; a new avatar
  // always wins over the flag.
  const removeAvatar = parsed.data.removeAvatar === true && !avatar;
  // A client can only ever upload under its own namespace; reject any path that
  // doesn't sit there before it's stored or moderated.
  if (avatar && !avatar.path.startsWith(`personaAvatars/${uid}/`)) {
    throw new HttpsError("invalid-argument", "invalid_avatar");
  }
  const personas = deps.db.collection("user_personas");

  // Resolve the target doc id. Overwrites verify ownership BEFORE moderation
  // (a foreign id must not burn an API call); the not-found never confirms
  // whether a foreign doc exists. Creates check the plan cap, also pre-spend.
  let personaId: string;
  let existingCreatedAt: unknown;
  // On an edit with no NEW avatar, carry the already-moderated one forward.
  let existingAvatarUrl: string | undefined;
  let existingAvatarPath: string | undefined;
  const requestedId = parsed.data.personaId;
  if (requestedId) {
    const snap = isUserPersonaId(requestedId)
      ? await personas.doc(requestedId).get()
      : null;
    const data = snap?.exists ? snap.data() : undefined;
    if (!data || data.ownerUid !== uid) {
      throw new HttpsError("not-found", "persona_not_found");
    }
    personaId = requestedId;
    existingCreatedAt = data.createdAt;
    const existingPublic = data.publicConfig as PersonaPublicConfig | undefined;
    existingAvatarUrl = existingPublic?.avatarUrl;
    existingAvatarPath = existingPublic?.avatarPath;
  } else {
    const cap = userPersonaCap(plan);
    const owned = await personas.where("ownerUid", "==", uid).get();
    if (owned.size >= cap) {
      throw new HttpsError("resource-exhausted", "persona_limit_reached", { cap });
    }
    personaId = newUserPersonaId(uid);
  }

  const publicConfig: PersonaPublicConfig = {
    displayName: input.displayName,
    shortDescription: input.publicConfig.shortDescription,
    toneTags: input.publicConfig.toneTags,
  };
  if (input.publicConfig.avatarKey) {
    publicConfig.avatarKey = input.publicConfig.avatarKey;
  }
  // New avatar wins; otherwise carry forward the existing (already-moderated)
  // one on an edit — unless the edit explicitly removed it. Only a NEW avatar is
  // moderated below.
  if (avatar) {
    publicConfig.avatarUrl = avatar.url;
    publicConfig.avatarPath = avatar.path;
  } else if (existingAvatarUrl && !removeAvatar) {
    publicConfig.avatarUrl = existingAvatarUrl;
    if (existingAvatarPath) publicConfig.avatarPath = existingAvatarPath;
  }

  const spec = toPersonaSpec(personaId, input);
  const verdict = await deps.moderate({ spec, publicConfig }, avatar?.url);
  if (!verdict.pass) {
    if (verdict.retryable) {
      // Infra failure inside a gate, not a content verdict — the client should
      // say "try again", never "rejected".
      throw new HttpsError("unavailable", "moderation_unavailable");
    }
    const failedGate = verdict.gates[verdict.gates.length - 1];
    void logFlaggedContent({
      uid,
      conversationId: null,
      messageId: null,
      reason: "persona_moderation",
      context: "persona",
      detail: `${failedGate.gate}:${failedGate.reason ?? "unknown"}`,
    });
    throw new HttpsError("invalid-argument", "persona_rejected", {
      gate: failedGate.gate,
      reason: failedGate.reason ?? "unknown",
      certainty: verdict.certainty,
    });
  }

  // Render ONCE at save time — serving reads the stored fragments and never
  // re-renders. renderPersonaPromptDoc never emits mediaDeciderKey for a
  // user-built spec (toPersonaSpec can't set media.deciderKey). publicConfig is
  // passed for the media note's identity grounding (one-liner + tone tags).
  const rendered = renderPersonaPromptDoc(spec, publicConfig);
  const doc = {
    id: personaId,
    ownerUid: uid,
    input,
    publicConfig,
    fragments: rendered.fragments,
    ...(rendered.mediaNotes ? { mediaNotes: rendered.mediaNotes } : {}),
    isEnabled: true,
    moderation: {
      certainty: verdict.certainty,
      gates: verdict.gates.map((g) => g.gate),
    },
    createdAt: existingCreatedAt ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (requestedId) {
    await personas.doc(personaId).set(doc);
  } else {
    // Transactional create: recheck the cap against a racing parallel save so
    // two in-flight creates can't both land past the limit.
    await deps.db.runTransaction(async (tx) => {
      const owned = await tx.get(personas.where("ownerUid", "==", uid));
      if (owned.size >= userPersonaCap(plan)) {
        throw new HttpsError("resource-exhausted", "persona_limit_reached", {
          cap: userPersonaCap(plan),
        });
      }
      tx.set(personas.doc(personaId), doc);
    });
  }

  // Edit cleanup: once the doc is written, drop the now-orphaned old avatar
  // object — either it was explicitly removed, or a new upload replaced it
  // (different path). Best-effort: a leftover object must never fail the save.
  if (deps.deleteObject && existingAvatarPath) {
    const replaced = !!avatar && existingAvatarPath !== avatar.path;
    if (removeAvatar || replaced) {
      await deps.deleteObject(existingAvatarPath).catch(() => {});
    }
  }

  return { personaId, publicConfig, certainty: verdict.certainty };
}

export async function deletePersonaForUser(
  uid: string,
  personaId: string,
  db: ReturnType<typeof getFirestore>,
  // Best-effort Storage cleanup of the persona's uploaded avatar. Injected so
  // the core stays testable without the Storage SDK; the callable provides the
  // real deleter.
  deleteObject?: (path: string) => Promise<void>,
): Promise<void> {
  const ref = db.collection("user_personas").doc(personaId);
  const snap = isUserPersonaId(personaId) ? await ref.get() : null;
  const data = snap?.exists ? snap.data() : undefined;
  if (!data || data.ownerUid !== uid) {
    throw new HttpsError("not-found", "persona_not_found");
  }
  const avatarPath = (data.publicConfig as PersonaPublicConfig | undefined)?.avatarPath;
  await ref.delete();
  if (deleteObject && typeof avatarPath === "string" && avatarPath) {
    // Never let a leftover Storage object block the delete the user asked for.
    await deleteObject(avatarPath).catch(() => {});
  }
  // We deliberately leave the deleted persona's id in every conversation's
  // participantPersonaIds (and on each message). The client resolves a now-
  // missing id to a "?" coin in both the chat and the history avatar stack —
  // an honest "this bot is gone" marker. Stripping the id instead emptied
  // single-bot conversations, leaving the history row with no avatar at all.
}

// `invoker: "public"` keeps Cloud Run's allUsers run.invoker binding asserted
// across redeploys (auth still enforced inside via request.auth) — matching
// updateProfile/deleteMyAccount and avoiding the post-deploy 401s.
export const savePersona = onCall(
  { region: "us-central1", invoker: "public", secrets: [OPENAI_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

    const entitlement = await loadEntitlement(uid);
    const service = new PersonaModerationService({ apiKey: OPENAI_API_KEY.value() });
    const result = await savePersonaForUser(uid, entitlement.plan, request.data, {
      db: getFirestore(),
      moderate: (input, imageUrl) => service.moderate(input, imageUrl),
      deleteObject: async (path) => {
        await getStorage().bucket().file(path).delete({ ignoreNotFound: true });
      },
    });

    logger.info("[savePersona] saved", {
      uid,
      personaId: result.personaId,
      certainty: result.certainty,
    });

    return { success: true as const, ...result };
  },
);

export const deletePersona = onCall(
  { region: "us-central1", invoker: "public" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

    const parsed = z
      .object({ personaId: z.string().trim().min(1).max(128) })
      .safeParse(request.data ?? {});
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", "invalid_request");
    }
    const personaId = parsed.data.personaId;

    const db = getFirestore();
    await deletePersonaForUser(uid, personaId, db, async (path) => {
      await getStorage().bucket().file(path).delete({ ignoreNotFound: true });
    });

    logger.info("[deletePersona] deleted", { uid, personaId });

    return { success: true as const };
  },
);
