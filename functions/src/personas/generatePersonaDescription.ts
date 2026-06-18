import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import OpenAI from "openai";
import { z } from "zod";
import { calculateCostUsd, calculateCredits } from "../billing/credits";
import { chargeCredits, evaluateQuota, type ModelUsage } from "../billing/ledger";
import { resolveModelId } from "../billing/models";
import type { PlanId } from "../billing/plans";
import { loadEntitlement } from "../entitlement/loadEntitlement";
import type { ProfileBilling } from "../entitlement/schema";
import { checkHateSpeech } from "../moderation/checkHateSpeech";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// ── generatePersonaDescription ───────────────────────────────────────────────
// Writes the persona's "who they are" description for the creator, from whatever
// the user has entered so far (name, tagline, vibe tags, humor). A deliberately
// cheap, light, non-streaming NANO call with NO reasoning — it's just drafting
// an opening description, not a task that needs to reason. Billed to the user
// against their normal credit allowance (one usageEvent of kind "persona_desc"),
// so it shares the daily/monthly limit with chat and avatar generation.
//
// Text-only: the picked avatar is intentionally NOT sent. nano is a text model
// (it reads images poorly and the vision pass blew the token budget, returning
// empty text — the "couldn't write it" failure). The entered name/tagline/vibe/
// humor describe the bot well enough for a punchy opener; keeping it nano keeps
// it fast and cheap. (The schema still accepts imageBase64 for back-compat with
// older clients, but the model call ignores it.)
//
// Safety: the generated text is run through the same moderation gate the chat
// title uses before it's returned, so a slur or hate-speech slip never reaches
// the field. The DURABLE gate is still publish-time (savePersona moderates the
// whole persona); this just keeps the suggestion clean.

// Mirrors LIMITS.identity in domain/personaForm.ts (the field's hard cap). We
// hard-clamp to this, but ASK the model for a much shorter description (a
// 600-char field invites a wall of text; a tight, punchy blurb reads better).
export const PERSONA_DESCRIPTION_MAX = 600;
const PERSONA_DESCRIPTION_TARGET = 300;

// Models are bad at hitting a stated character count and tend to overshoot, so
// we tell the model a tighter budget than the target. Then we hard-clamp.
const LENGTH_HINT_BUFFER = 14;

const requestSchema = z
  .object({
    // nullish (not just optional): the client sends `null` for steps the user
    // hasn't filled yet (e.g. tone/humor on the early "who are they" step). A
    // plain .optional() accepts undefined but REJECTS null, which rejected every
    // call as invalid_request and surfaced to the user as "Couldn't write it".
    displayName: z.string().trim().max(80).nullish(),
    shortDescription: z.string().trim().max(300).nullish(),
    toneTags: z.array(z.string().trim().max(40)).max(8).nullish(),
    humorTypes: z.array(z.string().trim().max(40)).max(8).nullish(),
    // The picked avatar as base64 (JPEG, from the creator's local image). Capped
    // generously; a 512px avatar JPEG base64 is well under this.
    imageBase64: z.string().max(4_000_000).nullish(),
  })
  .strict();

export type GeneratePersonaDescriptionInput = z.infer<typeof requestSchema>;
export type GeneratePersonaDescriptionResult = { description: string };

// A non-reasoning model copies concrete examples far more faithfully than it
// interprets adjectives like "energetic", so the few-shot block below is the
// main quality lever. The three examples span the personality range the starter
// templates imply (chaos / deadpan / wholesome), open three different ways (so
// blurbs don't come back same-y across users), and show meme-fluency through
// construction ("chosen violence", "emotional-support golden retriever") rather
// than slang dumps — with an explicit line against stacking slang, since that's
// a small model's failure mode. Kept em-dash-free on purpose.
const SYSTEM_PROMPT =
  "You help someone design a custom AI chat character (a \"bot\") inside Brainrot " +
  "Bot, a meme-fluent mobile chat app. From the details they've entered so far " +
  "(name, one-line tagline, vibe tags, humor style), write the character's " +
  "\"who they are\" hype blurb.\n\n" +
  "Write it AS a description of the character, in third person, like you're hyping " +
  "up a funny friend in the group chat. 1 to 3 short sentences. Make it land their " +
  "specific personality and what they're into: concrete and vivid, not generic. " +
  "Casual internet voice is good, but it should sound like a witty friend, not a " +
  "bot trying to be relatable: use at most one or two bits of slang, never a pile " +
  "of it, and skip forced filler. Vary how you open; don't start every blurb the " +
  "same way. Never corporate, never a bulleted list. Output ONLY the blurb text, " +
  "with no preamble, quotes, or labels.\n\n" +
  // Anti-AI-slop guardrails, distilled from the humanizer guide. A small model
  // drifts into generic brochure voice fast (worse on sparse input like a bare
  // name + tagline), so the tells are named explicitly rather than implied.
  "Sound like a real person typing, not AI marketing copy. Don't use brochure " +
  "words like vibrant, rich, vivid, stunning, boasts, renowned, testament, " +
  "tapestry, delve, crucial, enduring, showcase, dynamic, unleash, or elevate. " +
  "Don't write \"X is the Y of Z\" aphorisms (\"the life of the party\" style) " +
  "or \"not just X, it's Y\" setups, and don't force things into tidy groups of " +
  "three. Use plain verbs: say the character IS or HAS something, not that it " +
  "\"serves as,\" \"stands as,\" or \"boasts\" it. Skip filler hype endings like " +
  "\"ready for anything\" or \"the fun never stops.\" One concrete, oddly " +
  "specific detail beats three vague adjectives. No em dashes or en dashes.\n\n" +
  `Keep it short: under ${PERSONA_DESCRIPTION_TARGET - LENGTH_HINT_BUFFER} characters. A punchy blurb beats a wall of text.\n\n` +
  "Never include slurs, hate speech, content that sexualizes or demeans a real " +
  "identifiable person, or anything sexual involving minors.\n\n" +
  "Examples:\n\n" +
  "Name: Pixel\nTagline: terminally online gremlin\nVibe tags: chaotic, unhinged, " +
  "nocturnal\nHumor: absurdist, meme-poisoned\n-> Pixel runs on energy drinks, 3am " +
  "tangents, and zero impulse control. Will derail any conversation into lore from " +
  "a game you've never heard of, and is somehow always right. Touch grass? Never " +
  "met her.\n\n" +
  "Name: Sage\nTagline: dry wit, unbothered\nVibe tags: deadpan, calm, observant\n" +
  "Humor: sarcastic, deadpan\n-> Sage has read your message and chosen violence, " +
  "politely. Surgical sarcasm, zero wasted words. The friend who roasts you so " +
  "smoothly you end up thanking them for it.\n\n" +
  "Name: Sunny\nTagline: your biggest fan\nVibe tags: warm, soft, encouraging\n" +
  "Humor: gentle, wholesome\n-> Sunny genuinely thinks you're doing amazing. Part " +
  "cheerleader, part emotional-support golden retriever, here to gas you up and " +
  "remind you to drink water. Aggressively kind.";

// Injectable seams so the core logic (quota → generate → moderate → charge) runs
// in tests without the OpenAI SDK, network, or Firestore.
export type GenerateDescriptionDeps = {
  // Produces the description text + the model's token usage.
  generate: (
    input: GeneratePersonaDescriptionInput,
  ) => Promise<{ text: string; usage: TokenUsage }>;
  // Resolves true when the generated text is disallowed.
  moderate: (text: string) => Promise<boolean>;
  // Records the credit charge for the call.
  charge: (usage: TokenUsage) => Promise<void>;
};

type TokenUsage = Omit<ModelUsage, "model">;

// Hard-clamps to the field cap so an overshoot can never produce a value the
// strict save schema would reject. Trims to a word boundary when it can.
function clampDescription(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= PERSONA_DESCRIPTION_MAX) return trimmed;
  const cut = trimmed.slice(0, PERSONA_DESCRIPTION_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > PERSONA_DESCRIPTION_MAX - 40 ? cut.slice(0, lastSpace) : cut).trim();
}

export async function generateDescriptionForUser(
  plan: PlanId,
  billing: ProfileBilling,
  rawData: unknown,
  deps: GenerateDescriptionDeps,
): Promise<GeneratePersonaDescriptionResult> {
  const parsed = requestSchema.safeParse(rawData);
  if (!parsed.success) {
    // A reject here surfaces to the user as the generic "Couldn't write it", so
    // log which field tripped it — that's how we caught the client sending
    // `null` for unfilled tone/humor (now accepted via .nullish()).
    logger.warn("[generatePersonaDescription] schema reject", {
      fields: parsed.error.issues.map((i) => i.path.join(".")),
    });
    throw new HttpsError("invalid-argument", "invalid_request");
  }

  // Read-only quota gate (mirrors chat + avatar): refuse only when a window is
  // already exhausted; the real cost is charged after a successful generation.
  const quota = evaluateQuota({ state: billing, plan });
  if (!quota.ok) {
    throw new HttpsError(
      "resource-exhausted",
      quota.reason === "daily" ? "quota_daily" : "quota_monthly",
      { resetAt: quota.resetAt?.toISOString() ?? null },
    );
  }

  const { text, usage } = await deps.generate(parsed.data);
  const cleaned = text.trim();
  if (!cleaned) {
    throw new HttpsError("internal", "generation_failed");
  }

  // Run the suggestion through the same gate the chat title uses; reject rather
  // than return anything that trips it.
  const flagged = await deps.moderate(cleaned);
  if (flagged) {
    throw new HttpsError("invalid-argument", "description_rejected");
  }

  await deps.charge(usage);
  return { description: clampDescription(cleaned) };
}

// Builds the text-only user message + calls the nano model (non-streaming).
async function callModel(
  client: OpenAI,
  input: GeneratePersonaDescriptionInput,
): Promise<{ text: string; usage: TokenUsage }> {
  const lines: string[] = [];
  if (input.displayName) lines.push(`Name: ${input.displayName}`);
  if (input.shortDescription) lines.push(`Tagline: ${input.shortDescription}`);
  if (input.toneTags?.length) lines.push(`Vibe tags: ${input.toneTags.join(", ")}`);
  if (input.humorTypes?.length) lines.push(`Humor: ${input.humorTypes.join(", ")}`);

  const userText =
    lines.length > 0
      ? lines.join("\n")
      : "No details entered yet; invent a fun, playful character.";

  const completion = await client.chat.completions.create({
    // nano: this is a light, cheap one-shot write from text only. The avatar is
    // deliberately not sent (see the header note) — nano is a text model and the
    // vision pass is what made it return empty "couldn't write it" output.
    model: resolveModelId("nano"),
    // No reasoning: drafting an opening line doesn't need a reasoning pass, and
    // at "low" the budget got spent reasoning instead of writing. "none" gives
    // the whole budget to output and keeps it fast. The pinned SDK types this as
    // 'low'|'medium'|'high'|null, but the model accepts 'none' live, so cast.
    reasoning_effort: "none" as unknown as "low",
    max_completion_tokens: 1000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
  });

  const u = completion.usage;
  const content = completion.choices[0]?.message?.content ?? "";
  if (!content.trim()) {
    // Empty output is the one failure mode that surfaces as "Couldn't write it";
    // log enough to tell budget exhaustion (finish_reason "length") from a model
    // refusal or an upstream hiccup, so we're not guessing if it recurs.
    logger.warn("[generatePersonaDescription] empty model output", {
      finishReason: completion.choices[0]?.finish_reason ?? null,
      outputTokens: u?.completion_tokens ?? 0,
      reasoningTokens:
        (u?.completion_tokens_details as { reasoning_tokens?: number } | undefined)
          ?.reasoning_tokens ?? 0,
    });
  }
  return {
    text: content,
    usage: {
      inputTokens: u?.prompt_tokens ?? 0,
      cachedInputTokens:
        (u?.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ?? 0,
      outputTokens: u?.completion_tokens ?? 0,
      reasoningTokens:
        (u?.completion_tokens_details as { reasoning_tokens?: number } | undefined)
          ?.reasoning_tokens ?? 0,
    },
  };
}

// `invoker: "public"` keeps Cloud Run's allUsers run.invoker binding asserted
// across redeploys (auth still enforced inside via request.auth) — matching the
// other persona callables and avoiding post-deploy 401s.
export const generatePersonaDescription = onCall(
  { region: "us-central1", invoker: "public", secrets: [OPENAI_API_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

    const entitlement = await loadEntitlement(uid);
    const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });

    const result = await generateDescriptionForUser(
      entitlement.plan,
      entitlement,
      request.data,
      {
        generate: (input) => callModel(client, input),
        moderate: (text) => checkHateSpeech(text, OPENAI_API_KEY.value()),
        charge: (usage) => {
          const costUsd = calculateCostUsd("nano", usage);
          return chargeCredits(uid, entitlement.plan, {
            conversationId: "persona-description",
            messageId: null,
            kind: "persona_desc",
            usages: [{ model: "nano", ...usage }],
            costUsd,
            credits: calculateCredits(costUsd),
          });
        },
      },
    );

    logger.info("[generatePersonaDescription] generated", {
      uid,
      plan: entitlement.plan,
      length: result.description.length,
    });
    return { success: true as const, ...result };
  },
);
