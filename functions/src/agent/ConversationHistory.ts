import type { PlanId } from "../billing/plans";
import {
  assembleContext,
  type AssembledContext,
} from "../context/assemble";
import type { ExtractedGifFrames } from "../gifs/extractFrames";
import type { CurrentAttachmentTitles } from "../messages/attachmentMeta";
import type { MessageGif } from "../messages/messageGif";

export type HistoryAssembleArgs = {
  systemPrompt: string;
  // Paid-gated user memory block (<=500 tokens), injected as a system message.
  memoryBlock?: string;
  currentUserMessage: string;
  currentImageUrls?: string[];
  currentGif?: MessageGif;
  currentGifFrames?: ExtractedGifFrames;
  // Klipy titles of the current turn's attachments (newer clients only).
  currentAttachmentTitles?: CurrentAttachmentTitles;
  attachedMedia?: { kind: "gif" | "meme"; description: string };
  // Live web context fetched for this turn (see assemble.ts AssembleArgs.webContext).
  webContext?: string;
  // Per-turn style note (word-bank rotation + safety recap) injected in the
  // fresh tail right before the current turn.
  perTurnNote?: string;
  userAlias?: string | null;
  userLanguage?: string | null;
  excludeMessageIds?: string[];
};

// Owns a single conversation's stored history (recent verbatim turns + the
// rolling summary) and turns it, plus the current turn, into the model-ready
// message sequence. A thin OO seam over assembleContext so the Agent composes a
// named unit (history) rather than calling the assembler directly.
export class ConversationHistory {
  constructor(
    private readonly conversationId: string,
    private readonly plan: PlanId,
  ) {}

  assemble(args: HistoryAssembleArgs): Promise<AssembledContext> {
    return assembleContext({
      conversationId: this.conversationId,
      plan: this.plan,
      currentUserMessage: args.currentUserMessage,
      currentImageUrls: args.currentImageUrls,
      currentGif: args.currentGif,
      currentGifFrames: args.currentGifFrames,
      currentAttachmentTitles: args.currentAttachmentTitles,
      attachedMedia: args.attachedMedia,
      webContext: args.webContext,
      perTurnNote: args.perTurnNote,
      systemPrompt: args.systemPrompt,
      memoryBlock: args.memoryBlock,
      userAlias: args.userAlias,
      userLanguage: args.userLanguage,
      excludeMessageIds: args.excludeMessageIds,
    });
  }
}
