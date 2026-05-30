import { z } from "zod";
import { MAX_GIFS, messageGifSchema } from "./messages/messageGif";
import { MAX_IMAGES, messageImageSchema } from "./messages/messageImage";

// Request body for the streamAgentAnswer SSE endpoint. Text is optional (an
// attachment-only turn is valid), images are capped at MAX_IMAGES and gifs at
// MAX_GIFS (independent caps — a turn may carry both), and the refine rejects a
// turn that has neither text nor any attachment. Extracted from the function
// handler so the validation contract can be unit-tested directly.
export const streamAgentRequestSchema = z
  .object({
    message: z.string().max(4000).optional().default(""),
    images: z.array(messageImageSchema).max(MAX_IMAGES).optional().default([]),
    gifs: z.array(messageGifSchema).max(MAX_GIFS).optional().default([]),
    conversationId: z.string().min(1).optional(),
    clientMessageId: z.string().trim().min(1).max(128).optional(),
    personaId: z.string().trim().min(1).max(128).optional(),
    // Brainrot intensity dial (1 = Lightly Cooked, 2 = Rotted, 3 = Goblin Mode).
    // Stored on the user turn for now; the agent prompt is unaffected. Defaults
    // to 2 ("Rotted") to match the client's default selection.
    levelOfRot: z.number().int().min(1).max(3).optional().default(2),
  })
  .refine(
    (body) =>
      body.message.trim().length > 0 ||
      body.images.length > 0 ||
      body.gifs.length > 0,
    {
      message: "Message text or at least one attachment is required",
    },
  );

export type StreamAgentRequest = z.infer<typeof streamAgentRequestSchema>;
