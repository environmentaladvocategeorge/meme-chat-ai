import { z } from "zod";
import { MAX_GIFS, messageGifSchema } from "./messages/messageGif";
import { MAX_IMAGES, messageImageSchema } from "./messages/messageImage";
import { MAX_STICKERS, messageStickerSchema } from "./messages/messageSticker";

// Request body for the streamAgentAnswer SSE endpoint. Text is optional (an
// attachment-only turn is valid), images are capped at MAX_IMAGES, gifs at
// MAX_GIFS, and stickers at MAX_STICKERS (independent caps — a turn may carry
// any combination), and the refine rejects a turn that has neither text nor any
// attachment. Extracted from the function handler so the validation contract can
// be unit-tested directly.
//
// `stickers` is `.optional().default([])`: older clients that never send the
// field parse to `[]` and hit the exact same code path as today, so the backend
// can deploy ahead of the sticker-capable client without affecting live users.
export const streamAgentRequestSchema = z
  .object({
    message: z.string().max(4000).optional().default(""),
    images: z.array(messageImageSchema).max(MAX_IMAGES).optional().default([]),
    gifs: z.array(messageGifSchema).max(MAX_GIFS).optional().default([]),
    stickers: z
      .array(messageStickerSchema)
      .max(MAX_STICKERS)
      .optional()
      .default([]),
    // Optional. Existing conversations send their server-assigned id; a
    // brand-new chat may now send a CLIENT-GENERATED id so the app can subscribe
    // to the reply stream before the first reply lands (the backend creates the
    // doc with this id if it doesn't exist — see ensureConversation). Constrained
    // to a safe Firestore document-id charset so a provided id can never inject a
    // path segment. Server auto-ids (20-char alphanumeric) satisfy this, so older
    // clients passing an existing id are unaffected.
    conversationId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    clientMessageId: z.string().trim().min(1).max(128).optional(),
    personaId: z.string().trim().min(1).max(128).optional(),
    // Brainrot intensity dial (1 = Lightly Cooked, 2 = Rotted, 3 = Goblin Mode).
    // Stored on the user turn for now; the agent prompt is unaffected. Defaults
    // to 2 ("Rotted") to match the client's default selection.
    levelOfRot: z.number().int().min(1).max(3).optional().default(2),
    // The user's resolved app language (e.g. "en", "es"). The client resolves
    // "system" to a concrete code before sending, so this is never "system".
    // Folded into the per-user system message so the model knows which language
    // to default to. Optional — omitted turns just skip the language hint.
    language: z.string().trim().min(2).max(10).optional(),
    // Two local-only answering preferences the client toggles on device (NOT
    // synced to the cloud as profile settings, NOT stored in memory). Both
    // default to true so older clients that omit them keep today's behavior:
    //   respondWithEmojis=false → strip emoji guidance from the prompt + add an
    //     explicit "no emojis" directive (see rotLevel.ts rotLevelBlock).
    //   respondWithMedia=false  → skip the nano media decider entirely, so the
    //     turn never attaches a reaction GIF/meme.
    respondWithEmojis: z.boolean().optional().default(true),
    respondWithMedia: z.boolean().optional().default(true),
    // "Big Brain" reply-model upgrade for this turn: when true the reply runs on
    // the full gpt-5.4 model instead of the plan's standard model (see
    // billing/router.ts chooseReplyModel). Available on every tier — the pricier
    // model just costs more credits. Defaults FALSE so older clients that omit
    // the field, and the common turn, behave exactly as before.
    bigBrain: z.boolean().optional().default(false),
  })
  .refine(
    (body) =>
      body.message.trim().length > 0 ||
      body.images.length > 0 ||
      body.gifs.length > 0 ||
      body.stickers.length > 0,
    {
      message: "Message text or at least one attachment is required",
    },
  );

export type StreamAgentRequest = z.infer<typeof streamAgentRequestSchema>;
