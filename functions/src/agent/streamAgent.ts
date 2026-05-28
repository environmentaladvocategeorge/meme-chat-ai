import OpenAI from "openai";
import type { OpenAIMessage } from "../context/assemble";
import type { AgentDelta } from "./types";

// streamAgent is now model-agnostic: caller passes the resolved OpenAI model
// string (from resolveModelId(internalId)) and the plan's maxOutputTokens.
// Caller also assembles the message sequence (system/summary/recent/current);
// this function just streams the completion.
//
// stream_options.include_usage = true causes OpenAI to emit a final chunk
// carrying canonical token counts. We yield those as a `usage` delta so the
// orchestrator (streamAgentAnswer) can settle the credit reservation against
// real numbers rather than estimates.
export async function* streamAgent({
  messages,
  apiKey,
  model,
  maxOutputTokens,
  signal,
}: {
  messages: OpenAIMessage[];
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}): AsyncIterable<AgentDelta> {
  try {
    const client = new OpenAI({ apiKey });
    const stream = await client.chat.completions.create(
      {
        model,
        max_tokens: maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
        messages,
      },
      { signal },
    );

    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        yield { type: "delta", text };
      }
      const u = chunk.usage;
      if (u) {
        yield {
          type: "usage",
          usage: {
            inputTokens: u.prompt_tokens ?? 0,
            cachedInputTokens:
              (u.prompt_tokens_details as { cached_tokens?: number } | undefined)
                ?.cached_tokens ?? 0,
            outputTokens: u.completion_tokens ?? 0,
            reasoningTokens:
              (u.completion_tokens_details as { reasoning_tokens?: number } | undefined)
                ?.reasoning_tokens ?? 0,
          },
        };
      }
    }

    yield { type: "done" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "agent-error";
    yield { type: "error", message };
  }
}
