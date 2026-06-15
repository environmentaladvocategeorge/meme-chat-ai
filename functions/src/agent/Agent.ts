import type { PlanId } from "../billing/plans";
import type { AssembledContext } from "../context/assemble";
import type { ExtractedGifFrames } from "../gifs/extractFrames";
import type { CurrentAttachmentTitles } from "../messages/attachmentMeta";
import type { MessageGif } from "../messages/messageGif";
import { buildPerTurnNote } from "../personas/perTurnNote";
import {
  buildSystemPromptForStream,
  type ResolvedPersonaForStream,
} from "../personas/prompts";
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
  // Persona + prompt already resolved by the orchestrator (it resolves once
  // per turn, before the media decider, and shares the result). When present,
  // personaId is ignored and the persona docs are never read twice. Absent =
  // the Agent resolves from personaId itself (back-compat).
  resolvedPersona?: ResolvedPersonaForStream;
  levelOfRot: number;
  // The user's "Respond with emojis" toggle (local-only, sent per turn).
  // Defaults to true; when false the persona prompt's emoji guidance is swapped
  // for a "no emojis" directive (see buildSystemPromptForStream).
  respondWithEmojis?: boolean;
  memory: MemoryService;
};

export type BuildReplyContextArgs = {
  conversationId: string;
  currentUserMessage: string;
  currentImageUrls?: string[];
  currentGif?: MessageGif;
  currentGifFrames?: ExtractedGifFrames;
  // Klipy titles of the current turn's attachments (newer clients only).
  currentAttachmentTitles?: CurrentAttachmentTitles;
  attachedMedia?: { kind: "gif" | "meme"; description: string };
  userAlias?: string | null;
  userLanguage?: string | null;
  // Pre-rendered reply memory block. When the orchestrator has already read the
  // memory state (e.g. to also feed the media decider), it passes the reply view
  // here so the Agent doesn't read it again. Omitted = the Agent fetches it
  // itself (back-compat). Empty string is a valid value (no memory).
  memoryBlock?: string;
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
      buildSystemPromptForStream(
        this.cfg.personaId,
        this.cfg.levelOfRot,
        this.cfg.respondWithEmojis ?? true,
        this.cfg.resolvedPersona,
      ),
      // Use the orchestrator-supplied reply block when present (it already read
      // the state to feed the decider); otherwise fetch it ourselves.
      args.memoryBlock !== undefined
        ? Promise.resolve(args.memoryBlock)
        : this.cfg.memory.getMemoryBlock(this.cfg.uid, this.cfg.plan),
    ]);

    // The per-turn safety recap rides AFTER the history (fresh tail) so the
    // system prompt + history stay prefix-cacheable; see personas/perTurnNote.ts.
    // (The word bank now lives in each persona's prompt, not here.)
    const perTurnNote = buildPerTurnNote();

    const history = new ConversationHistory(args.conversationId, this.cfg.plan);
    const assembled = await history.assemble({
      systemPrompt: promptResult.systemPrompt,
      perTurnNote,
      memoryBlock,
      currentUserMessage: args.currentUserMessage,
      currentImageUrls: args.currentImageUrls,
      currentGif: args.currentGif,
      currentGifFrames: args.currentGifFrames,
      currentAttachmentTitles: args.currentAttachmentTitles,
      attachedMedia: args.attachedMedia,
      userAlias: args.userAlias,
      userLanguage: args.userLanguage,
      excludeMessageIds: args.excludeMessageIds,
    });

    return { assembled, persona: promptResult.persona };
  }
}
