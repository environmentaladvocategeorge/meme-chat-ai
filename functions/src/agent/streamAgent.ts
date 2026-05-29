import { logger } from "firebase-functions";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { OpenAIMessage } from "../context/assemble";
import type { AgentDelta } from "./types";

// Map our internal message shape onto the SDK's discriminated union. The
// content parts we emit (text + image_url with detail:"low") are structurally
// identical to the SDK's ChatCompletionContentPart types; this just satisfies
// the role-discriminated overload. Only the user turn ever carries parts.
function toChatParams(messages: OpenAIMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "user") {
      return { role: "user", content: m.content } as ChatCompletionMessageParam;
    }
    return {
      role: m.role,
      content: typeof m.content === "string" ? m.content : "",
    } as ChatCompletionMessageParam;
  });
}

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
        // gpt-5.x models reject the legacy `max_tokens` — they require
        // `max_completion_tokens`. Sending the old key 400s before any token.
        max_completion_tokens: maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
        messages: toChatParams(messages),
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
    // Surface the real OpenAI failure at the source. SDK APIErrors carry
    // status/code/type that pin down model_not_found vs auth vs bad-param far
    // better than the message alone — and logging here sidesteps the reserved
    // `message` field collision in the downstream logger.
    const e = error as {
      name?: string;
      status?: number;
      code?: string;
      type?: string;
      param?: string;
      message?: string;
    };
    logger.error("[streamAgent] OpenAI stream failed", {
      model,
      name: e?.name,
      status: e?.status,
      code: e?.code,
      type: e?.type,
      param: e?.param,
      detail: e?.message,
    });
    const message = error instanceof Error ? error.message : "agent-error";
    yield { type: "error", message };
  }
}
