import type { PlanId } from "../billing/plans";
import {
  assembleContext,
  type AssembledContext,
} from "../context/assemble";
import type { ExtractedGifFrames } from "../gifs/extractFrames";
import type { MessageGif } from "../messages/messageGif";

export type HistoryAssembleArgs = {
  systemPrompt: string;
  // Paid-gated user memory block (<=500 tokens), injected as a system message.
  memoryBlock?: string;
  currentUserMessage: string;
  currentImageUrls?: string[];
  currentGif?: MessageGif;
  currentGifFrames?: ExtractedGifFrames;
  attachedMedia?: { kind: "gif" | "meme"; description: string };
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
      attachedMedia: args.attachedMedia,
      systemPrompt: args.systemPrompt,
      memoryBlock: args.memoryBlock,
      userAlias: args.userAlias,
      userLanguage: args.userLanguage,
      excludeMessageIds: args.excludeMessageIds,
    });
  }
}
