import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import OpenAI from "openai";
import { z } from "zod";
import { calculateCredits } from "../billing/credits";
import { chargeCredits, evaluateQuota, flatCostSettlement } from "../billing/ledger";
import {
  AVATAR_IMAGE_MODEL,
  AVATAR_IMAGE_QUALITY,
  AVATAR_IMAGE_SIZE,
  AVATAR_IMAGE_USD,
} from "../billing/models";
import type { PlanId } from "../billing/plans";
import { loadEntitlement } from "../entitlement/loadEntitlement";
import type { ProfileBilling } from "../entitlement/schema";
import { PERSONA_BLOCKED_CATEGORIES } from "../moderation/personaModeration";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// ── generatePersonaAvatar ────────────────────────────────────────────────────
// Generates ONE avatar image for the persona creator from a short (≤100 char)
// user description, using gpt-image-1-mini at the cheapest avatar-suitable tier
// (see billing/models.ts). The client calls this twice in parallel to offer two
// candidates; each call gates + charges independently against the user's normal
// credit allowance (one usageEvent of kind "avatar"), so avatar generation
// shares the daily/monthly limit with chat.
//
// Safety is layered: (1) the user's prompt is screened by OpenAI moderation
// here; (2) the image API enforces its own prompt safety and rejects disallowed
// requests; (3) the DURABLE gate is publish-time — savePersona moderates the
// chosen image multimodally before it is ever stored. This callable stores
// nothing: it returns base64 to the client, which keeps it only if the user
// picks it (then it rides the existing upload+moderation+save path).

export const AVATAR_DESCRIPTION_MAX = 100;

const requestSchema = z
  .object({
    description: z.string().trim().min(1).max(AVATAR_DESCRIPTION_MAX),
    // Optional art-direction selector. The client sends a different value for
    // each of its two parallel calls (a random rotation + 0/1), so the pair
    // never comes back near-identical and varies across regenerations.
    variant: z.number().int().optional(),
  })
  .strict();

export type GenerateAvatarResult = { imageBase64: string };

// Injectable seams: tests swap the moderation, generation, and charge calls so
// the core runs without the OpenAI SDK, network, or Firestore.
export type GenerateAvatarDeps = {
  // Resolves true when the prompt text is disallowed (should not be generated).
  moderatePrompt: (text: string) => Promise<boolean>;
  // Produces the base64 image + the real USD cost of the call.
  generate: (prompt: string) => Promise<{ b64: string; costUsd: number }>;
  // Records the credit charge against the user's ledger.
  charge: (credits: number, costUsd: number) => Promise<void>;
};

// Distinct DEFAULT art directions so two generations of the same description
// don't come back near-identical (gpt-image-1-mini is fairly stable on a fixed
// prompt, so the differing composition line is what forces variety). Selected by
// `variant`. They only kick in when the description doesn't ask for its own
// background or framing; if it does, the user's choice wins (see buildAvatarPrompt). All
// keep the WHOLE head visible and the lighting flat — a chat avatar lives at
// thumbnail size cropped to a circle, so rim-lit / tightly-cropped framings that
// muddy or behead the subject are deliberately avoided; they only vary the
// background and angle.
export const AVATAR_VARIATIONS = [
  "a front-facing portrait on a soft solid-color studio background",
  "a three-quarter side angle on a bold flat duotone background",
  "a slightly closer crop with the full head visible on a playful gradient background",
  "a head-and-shoulders shot with soft even top lighting on a clean two-tone background",
  "a slightly low hero angle on a bright complementary-color background",
  "a centered pose on a subtle radial-glow background with a few simple floating accent shapes like stars or sparkles",
] as const;

// Wraps the user's description in avatar framing, ordered so their wording wins
// on look while the avatar shape stays put. First the format that always holds: a
// single centered subject that still reads once it's shrunk to a circle in the
// chat list. Then a default style — the sticker/emote look plus a `variant`-picked
// composition — but only when the user hasn't asked for a style of their own.
// Last, a line telling the model that if the description names a style, medium,
// background, or mood, it should follow that and drop the defaults. Letting the
// description steer the art is safe here: the text is moderated before this runs,
// the image API has its own safety, and savePersona re-checks the chosen image
// before it is ever stored.
export function buildAvatarPrompt(description: string, variant = 0): string {
  const len = AVATAR_VARIATIONS.length;
  const variation = AVATAR_VARIATIONS[((variant % len) + len) % len];
  return [
    // Format — always applies, whatever style the user picks.
    "A profile-picture avatar for a chat app: a single subject, prominent and",
    "centered, that reads instantly at small sizes in a message list and crops",
    "cleanly to a circle. No text, no watermark, no logos, no signature, no border.",
    // Default look — applies ONLY when the description sets no style of its own.
    "Unless the description below specifies an art style, render it as a bold",
    "sticker / emote: thick clean outline, flat vibrant colors with simple cel",
    "shading, a strong recognizable silhouette, a limited palette of 3 to 5 colors,",
    "head-and-shoulders and filling the frame, with playfully exaggerated features",
    "and one clear expressive emotion that shows personality.",
    `Composition (default, when the description sets none of its own): ${variation}.`,
    // Precedence — the user's words win on style, medium, background, and mood.
    "The description takes precedence over these defaults: if it names an art style",
    "or medium (for example a realistic photo, watercolor, oil painting, 3D render,",
    "pixel art, anime), a background or setting, or a specific mood, follow it",
    "exactly and let it override the default look and composition above.",
    "The character to depict:",
    description.trim(),
  ].join(" ");
}

export async function generateAvatarForUser(
  plan: PlanId,
  billing: ProfileBilling,
  rawData: unknown,
  deps: GenerateAvatarDeps,
): Promise<GenerateAvatarResult> {
  const parsed = requestSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "invalid_request");
  }

  // Read-only quota gate (mirrors chat): refuse only when a window is already
  // exhausted. The real cost is charged after a successful generation.
  const quota = evaluateQuota({ state: billing, plan });
  if (!quota.ok) {
    throw new HttpsError(
      "resource-exhausted",
      quota.reason === "daily" ? "quota_daily" : "quota_monthly",
      { resetAt: quota.resetAt?.toISOString() ?? null },
    );
  }

  const flagged = await deps.moderatePrompt(parsed.data.description);
  if (flagged) {
    throw new HttpsError("invalid-argument", "prompt_rejected");
  }

  const { b64, costUsd } = await deps.generate(
    buildAvatarPrompt(parsed.data.description, parsed.data.variant),
  );
  // Charge after success (no up-front reservation), exactly like a chat turn.
  await deps.charge(calculateCredits(costUsd), costUsd);
  return { imageBase64: b64 };
}

// ── production OpenAI seams ───────────────────────────────────────────────────

// Screens the prompt against the same blocked categories savePersona uses.
// Fails OPEN (returns "not flagged") on an infra error: the image API's own
// safety system and publish-time moderation remain the gates, so a moderation
// outage shouldn't block the user from generating.
async function isPromptBlocked(client: OpenAI, text: string): Promise<boolean> {
  try {
    const result = await client.moderations.create({
      model: "omni-moderation-latest",
      input: text,
    });
    for (const r of result.results) {
      const categories = r.categories as unknown as Record<string, boolean>;
      for (const category of PERSONA_BLOCKED_CATEGORIES) {
        if (categories[category] === true) return true;
      }
    }
    return false;
  } catch (err) {
    logger.warn(
      "[generatePersonaAvatar] prompt moderation failed; deferring to image-API safety",
      { detail: err instanceof Error ? err.message : "unknown" },
    );
    return false;
  }
}

// True when an OpenAI error is its prompt-safety rejection (so the client can
// say "try different wording" rather than "something went wrong").
function isPromptSafetyError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError && err.status === 400) {
    const code = (err as { code?: string }).code ?? "";
    const msg = (err.message ?? "").toLowerCase();
    return (
      code === "moderation_blocked" ||
      msg.includes("safety system") ||
      msg.includes("moderation")
    );
  }
  return false;
}

async function generateAvatarImage(
  client: OpenAI,
  prompt: string,
): Promise<{ b64: string; costUsd: number }> {
  try {
    const res = await client.images.generate({
      model: AVATAR_IMAGE_MODEL,
      prompt,
      size: AVATAR_IMAGE_SIZE,
      quality: AVATAR_IMAGE_QUALITY,
      n: 1,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error("no_image_data");
    return { b64, costUsd: AVATAR_IMAGE_USD };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (isPromptSafetyError(err)) {
      throw new HttpsError("invalid-argument", "prompt_rejected");
    }
    logger.error("[generatePersonaAvatar] image generation failed", {
      detail: err instanceof Error ? err.message : "unknown",
    });
    throw new HttpsError("internal", "generation_failed");
  }
}

// `invoker: "public"` keeps Cloud Run's allUsers run.invoker binding asserted
// across redeploys (auth still enforced inside via request.auth) — matching
// savePersona/updateProfile and avoiding the post-deploy 401s.
export const generatePersonaAvatar = onCall(
  { region: "us-central1", invoker: "public", secrets: [OPENAI_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

    const entitlement = await loadEntitlement(uid);
    const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });

    const result = await generateAvatarForUser(entitlement.plan, entitlement, request.data, {
      moderatePrompt: (text) => isPromptBlocked(client, text),
      generate: (prompt) => generateAvatarImage(client, prompt),
      charge: (credits, costUsd) =>
        chargeCredits(
          uid,
          entitlement.plan,
          flatCostSettlement({
            conversationId: "persona-avatar",
            kind: "avatar",
            costUsd,
            credits,
          }),
        ),
    });

    logger.info("[generatePersonaAvatar] generated", { uid, plan: entitlement.plan });
    return { success: true as const, ...result };
  },
);
