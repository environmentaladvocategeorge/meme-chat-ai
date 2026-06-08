import type { PlanId } from "../billing/plans";
import type { AssembledContext } from "../context/assemble";
import type { ExtractedGifFrames } from "../gifs/extractFrames";
import type { MessageGif } from "../messages/messageGif";
import { buildSystemPromptForStream } from "../personas/prompts";
import { ConversationHistory } from "./ConversationHistory";
import type { MemoryService } from "./memory";

type ResolvedPersona = Awaited<
  ReturnType<typeof buildSystemPromptForStream>
>["persona"];

export type ReplyContext = {
  assembled: AssembledContext;
  persona: ResolvedPersona;
};

export type AgentConfig = {
  uid: string;
  plan: PlanId;
  personaId?: string;
  levelOfRot: number;
  memory: MemoryService;
};

export type BuildReplyContextArgs = {
  conversationId: string;
  currentUserMessage: string;
  currentImageUrls?: string[];
  currentGif?: MessageGif;
  currentGifFrames?: ExtractedGifFrames;
  attachedMedia?: { kind: "gif" | "meme"; description: string };
  userAlias?: string | null;
  userLanguage?: string | null;
  excludeMessageIds?: string[];
};

// Composes the per-turn agent: persona (system prompt + identity), the user's
// long-term Memory (paid-gated), and the ConversationHistory. The orchestrator
// (streamAgentAnswer) handles transport, the media decision, streaming, and
// billing; the Agent owns "what the model sees."
export class Agent {
  constructor(private readonly cfg: AgentConfig) {}

  // Builds the full model context for a reply turn. The memory read runs in
  // PARALLEL with persona resolution and never makes a model call, so it adds no
  // measurable turn latency. Memory is "" for plans without it.
  async buildReplyContext(args: BuildReplyContextArgs): Promise<ReplyContext> {
    const [promptResult, memoryBlock] = await Promise.all([
      buildSystemPromptForStream(this.cfg.personaId, this.cfg.levelOfRot),
      this.cfg.memory.getMemoryBlock(this.cfg.uid, this.cfg.plan),
    ]);

    const history = new ConversationHistory(args.conversationId, this.cfg.plan);
    const assembled = await history.assemble({
      systemPrompt: promptResult.systemPrompt,
      memoryBlock,
      currentUserMessage: args.currentUserMessage,
      currentImageUrls: args.currentImageUrls,
      currentGif: args.currentGif,
      currentGifFrames: args.currentGifFrames,
      attachedMedia: args.attachedMedia,
      userAlias: args.userAlias,
      userLanguage: args.userLanguage,
      excludeMessageIds: args.excludeMessageIds,
    });

    return { assembled, persona: promptResult.persona };
  }
}
