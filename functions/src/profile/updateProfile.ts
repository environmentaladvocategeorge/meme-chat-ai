import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { checkHateSpeech } from "../moderation/checkHateSpeech";
import { logFlaggedContent } from "../moderation/logFlaggedContent";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// Free-text personalization captured during onboarding. The alias is the name
// Brainrot Bot uses when it addresses the user ("bestie", "menace", "Jorge", …). It is
// written to profiles/{uid} so it survives reinstall and is available to the
// answer pipeline server-side. The client never writes to profiles directly —
// firestore.rules only allows `get` on the user's own doc — so this callable is
// the sole path that records it.
export const MAX_ALIAS_LENGTH = 40;

const schema = z.object({
  // Loose inbound bound; normalizeAlias does the real trimming/clamping.
  alias: z.string().max(500).optional(),
  displayName: z.string().max(500).optional(),
  // Onboarding marks the profile complete on finish; defaults to true.
  onboardingCompleted: z.boolean().optional(),
});

type Db = ReturnType<typeof getFirestore>;

export type UpdateProfileArgs = {
  alias?: string;
  displayName?: string;
  onboardingCompleted?: boolean;
};

export type UpdateProfileResult = {
  alias: string | null;
  displayName: string | null;
  onboardingCompleted: boolean;
};

// Pure normalizer (testable): trims, collapses runs of whitespace, clamps to
// MAX_ALIAS_LENGTH, and maps an effectively-empty value to null so the caller
// can decide between "write this name" and "clear it". Returns null for
// undefined input so an absent field is treated the same as a cleared one only
// at the call site that chooses to pass it.
export function normalizeAlias(input: string | undefined): string | null {
  if (input === undefined) return null;
  const trimmed = input.trim().replace(/\s+/g, " ").slice(0, MAX_ALIAS_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

// Pure core (testable): merges the onboarding personalization onto
// profiles/{uid}. An explicitly provided-but-empty alias/displayName clears the
// stored field (FieldValue.delete) so the doc reads back as "no name" rather
// than an empty string; an omitted field is left untouched.
export async function updateProfileForUser(
  uid: string,
  args: UpdateProfileArgs,
  db: Db,
): Promise<UpdateProfileResult> {
  const completed = args.onboardingCompleted ?? true;
  const patch: Record<string, unknown> = {
    onboardingCompleted: completed,
    onboardingCompletedAt: FieldValue.serverTimestamp(),
  };

  let aliasOut: string | null = null;
  if (args.alias !== undefined) {
    aliasOut = normalizeAlias(args.alias);
    patch.alias = aliasOut ?? FieldValue.delete();
  }

  let displayNameOut: string | null = null;
  if (args.displayName !== undefined) {
    displayNameOut = normalizeAlias(args.displayName);
    patch.displayName = displayNameOut ?? FieldValue.delete();
  }

  await db.doc(`profiles/${uid}`).set(patch, { merge: true });

  return { alias: aliasOut, displayName: displayNameOut, onboardingCompleted: completed };
}

// Persists onboarding personalization (alias / display name) and stamps the
// profile complete. `invoker: "public"` keeps Cloud Run's allUsers run.invoker
// binding asserted across redeploys — the function still authenticates inside
// via request.auth — matching deleteMyAccount and avoiding the post-deploy 401s.
export const updateProfile = onCall(
  { region: "us-central1", invoker: "public", secrets: [OPENAI_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

    const parsed = schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", "invalid-request");
    }

    // Hate speech check on alias and displayName. Runs only when the field is
    // present and non-empty — clearing a name (empty string) is always allowed.
    const apiKey = OPENAI_API_KEY.value();
    const fieldsToCheck: Array<{ value: string | undefined; context: "alias" | "display_name" }> = [
      { value: parsed.data.alias, context: "alias" },
      { value: parsed.data.displayName, context: "display_name" },
    ];
    for (const { value, context } of fieldsToCheck) {
      if (!value || !value.trim()) continue;
      let flagged = false;
      try {
        flagged = await checkHateSpeech(value, apiKey);
      } catch (err) {
        logger.warn("[updateProfile] hate speech check threw; failing open", { uid, context, err });
      }
      if (flagged) {
        logger.warn("[updateProfile] hate speech detected in name field", { uid, context });
        void logFlaggedContent({ uid, conversationId: null, messageId: null, reason: "hate_speech", context });
        throw new HttpsError("invalid-argument", "hate_speech_detected");
      }
    }

    const result = await updateProfileForUser(uid, parsed.data, getFirestore());

    logger.info("[updateProfile] saved", {
      uid,
      hasAlias: result.alias !== null,
      onboardingCompleted: result.onboardingCompleted,
    });

    return { success: true as const, ...result };
  },
);
