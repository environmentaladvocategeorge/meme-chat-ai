import OpenAI from "openai";
import type { AgentDelta, ChatMessage } from "./types";

const MODEL = "gpt-4o-mini";

type OpenAIMessage = {
  role: "user" | "assistant";
  content: string;
};

function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages.map((m) => ({
    role: m.role === "agent" ? "assistant" : "user",
    content: m.text,
  }));
}

export async function* streamAgent({
  messages,
  apiKey,
  signal,
}: {
  messages: ChatMessage[];
  apiKey: string;
  signal?: AbortSignal;
}): AsyncIterable<AgentDelta> {
  try {
    const client = new OpenAI({ apiKey });
    const stream = await client.chat.completions.create(
      {
        model: MODEL,
        max_tokens: 1024,
        stream: true,
        messages: toOpenAIMessages(messages),
      },
      { signal },
    );

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        yield { type: "delta", text };
      }
    }

    yield { type: "done" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "agent-error";
    yield { type: "error", message };
  }
}
