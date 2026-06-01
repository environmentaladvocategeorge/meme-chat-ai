import { logger } from "firebase-functions";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { OpenAIMessage } from "../context/assemble";
import type { MessageGif } from "../messages/messageGif";
import type { MessageImage } from "../messages/messageImage";
import type { AgentDelta, AgentUsage } from "./types";

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

// Result of running one tool call. `content` is the string fed back to the
// model as the tool message; `meme` is an optional attachment the orchestrator
// surfaces to the client and persists (see runGetMeme).
export type ToolRunResult = {
  content: string;
  meme?: MessageImage;
  gif?: MessageGif;
};

// Runs a single tool call the model requested. Implementations should never
// throw — they map failures to a tool message so the conversation continues.
export type ToolRunner = (call: {
  name: string;
  arguments: string;
}) => Promise<ToolRunResult>;

// How many rounds the model may call tools before we force a plain answer. One
// round covers the single get_meme case; the cap stops a misbehaving model
// from looping indefinitely.
const MAX_TOOL_ROUNDS = 1;

type AccumulatedToolCall = { id: string; name: string; arguments: string };

// Optional sampling knobs spread into the OpenAI completion call. Used by turn
// replay to nudge the model toward a different answer than last time: a fresh
// `seed` reshuffles the sampling RNG, and a varied `top_p` widens/narrows the
// token pool. Omitted entirely on a normal turn so the request stays
// byte-identical to before (and fully cacheable). Note: gpt-5.x reasoning
// models reject a non-default `temperature`, so we deliberately don't expose it.
export type SamplingOverrides = {
  topP?: number;
  seed?: number;
};

function emptyUsage(): AgentUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}

// streamAgent is model-agnostic: caller passes the resolved OpenAI model string
// (from resolveModelId(internalId)) and the plan's maxOutputTokens. Caller also
// assembles the message sequence (system/summary/recent/current).
//
// When `tools` + `runTool` are supplied, the model may request a tool call; we
// stream the first completion, run any tool calls, append the results, and
// stream a follow-up completion that produces the final answer. Each completion
// emits its own usage chunk (stream_options.include_usage); we sum them across
// rounds and yield a single `usage` delta so the orchestrator settles credits
// against the turn's real total token cost.
export async function* streamAgent({
  messages,
  apiKey,
  model,
  maxOutputTokens,
  tools,
  runTool,
  sampling,
  signal,
}: {
  messages: OpenAIMessage[];
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  tools?: ChatCompletionTool[];
  runTool?: ToolRunner;
  // Optional per-request sampling overrides (see SamplingOverrides). Applied to
  // every completion round in this turn so a replay stays varied even through
  // the tool loop.
  sampling?: SamplingOverrides;
  signal?: AbortSignal;
}): AsyncIterable<AgentDelta> {
  try {
    const client = new OpenAI({ apiKey });
    const convo = toChatParams(messages);
    const toolsEnabled = Boolean(tools && tools.length > 0 && runTool);
    const totalUsage = emptyUsage();
    // Only include keys that are actually set, so a normal turn (no overrides)
    // sends no `top_p`/`seed` at all and stays identical to the prior behavior.
    const samplingParams: { top_p?: number; seed?: number } = {};
    if (typeof sampling?.topP === "number") samplingParams.top_p = sampling.topP;
    if (typeof sampling?.seed === "number") samplingParams.seed = sampling.seed;

    for (let round = 0; ; round++) {
      // Tools are offered only while we still have a tool round left; the final
      // forced round drops them so the model must produce text.
      const offerTools = toolsEnabled && round < MAX_TOOL_ROUNDS;

      const stream = await client.chat.completions.create(
        {
          model,
          // gpt-5.x models reject the legacy `max_tokens` — they require
          // `max_completion_tokens`. Sending the old key 400s before any token.
          max_completion_tokens: maxOutputTokens,
          stream: true,
          stream_options: { include_usage: true },
          messages: convo,
          ...samplingParams,
          ...(offerTools ? { tools, tool_choice: "auto" as const } : {}),
        },
        { signal },
      );

      let assistantText = "";
      let finishReason: string | null = null;
      const toolCalls = new Map<number, AccumulatedToolCall>();

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;

        const text = delta?.content;
        if (typeof text === "string" && text.length > 0) {
          assistantText += text;
          yield { type: "delta", text };
        }

        // Tool-call fragments arrive split across chunks and keyed by index;
        // accumulate name + arguments per index until the stream completes.
        for (const tc of delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const acc = toolCalls.get(idx) ?? { id: "", name: "", arguments: "" };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
          toolCalls.set(idx, acc);
        }

        if (choice?.finish_reason) finishReason = choice.finish_reason;

        const u = chunk.usage;
        if (u) {
          totalUsage.inputTokens += u.prompt_tokens ?? 0;
          totalUsage.cachedInputTokens +=
            (u.prompt_tokens_details as { cached_tokens?: number } | undefined)
              ?.cached_tokens ?? 0;
          totalUsage.outputTokens += u.completion_tokens ?? 0;
          totalUsage.reasoningTokens +=
            (
              u.completion_tokens_details as
                | { reasoning_tokens?: number }
                | undefined
            )?.reasoning_tokens ?? 0;
        }
      }

      // Model asked for tools and we still allow a round: run them, append the
      // assistant tool-call turn + each tool result, then loop for the answer.
      if (
        offerTools &&
        finishReason === "tool_calls" &&
        toolCalls.size > 0 &&
        runTool
      ) {
        const calls = [...toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, c]) => c)
          .filter((c) => c.id && c.name);

        convo.push({
          role: "assistant",
          content: assistantText.length > 0 ? assistantText : null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: c.arguments },
          })),
        } as ChatCompletionMessageParam);

        for (const call of calls) {
          let result: ToolRunResult;
          try {
            result = await runTool({ name: call.name, arguments: call.arguments });
          } catch (err) {
            logger.warn("[streamAgent] tool runner threw", { tool: call.name, err });
            result = { content: JSON.stringify({ error: "tool_failed" }) };
          }

          if (result.meme) {
            yield { type: "meme", image: result.meme };
          }
          if (result.gif) {
            yield { type: "gif", gif: result.gif };
          }

          convo.push({
            role: "tool",
            tool_call_id: call.id,
            content: result.content,
          } as ChatCompletionMessageParam);
        }

        continue;
      }

      break;
    }

    yield { type: "usage", usage: totalUsage };
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
