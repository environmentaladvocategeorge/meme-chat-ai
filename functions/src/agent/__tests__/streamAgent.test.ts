// Mock the OpenAI SDK with a fake streaming client. The constructor exposes the
// create mock as a static so the test can drive per-round chunk sequences.
jest.mock("openai", () => {
  const create = jest.fn();
  return {
    __esModule: true,
    default: class {
      static create = create;
      chat = { completions: { create } };
    },
  };
});

import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { streamAgent, type ToolRunResult } from "../streamAgent";
import type { AgentDelta } from "../types";
import type { MessageImage } from "../../messages/messageImage";

const mockCreate = (OpenAI as unknown as { create: jest.Mock }).create;

// Builds the resolved value of client.chat.completions.create: a promise of an
// async-iterable of chat-completion chunks.
function streamOf(chunks: unknown[]) {
  return Promise.resolve({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  });
}

function textChunk(content: string) {
  return { choices: [{ delta: { content }, finish_reason: null }] };
}

function finishChunk(reason: string) {
  return { choices: [{ delta: {}, finish_reason: reason }] };
}

function usageChunk(prompt: number, completion: number) {
  return {
    choices: [],
    usage: { prompt_tokens: prompt, completion_tokens: completion },
  };
}

const BASE = {
  messages: [{ role: "user" as const, content: "hey" }],
  apiKey: "k",
  model: "gpt-test",
  maxOutputTokens: 256,
};

async function collect(iter: AsyncIterable<AgentDelta>): Promise<AgentDelta[]> {
  const out: AgentDelta[] = [];
  for await (const d of iter) out.push(d);
  return out;
}

const MEME: MessageImage = {
  id: "1",
  source: "klipy",
  url: "https://static.klipy.com/a.webp",
  previewUrl: "https://static.klipy.com/a.webp",
};

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: { name: "get_meme", description: "d", parameters: { type: "object" } },
  },
];

beforeEach(() => {
  mockCreate.mockReset();
});

describe("streamAgent (no tools)", () => {
  it("streams text, sums usage once, and finishes — single completion", async () => {
    mockCreate.mockReturnValueOnce(
      streamOf([textChunk("Hel"), textChunk("lo"), finishChunk("stop"), usageChunk(10, 4)]),
    );

    const deltas = await collect(streamAgent(BASE));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      {
        type: "usage",
        usage: {
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 4,
          reasoningTokens: 0,
        },
      },
      { type: "done" },
    ]);
    // No tools passed → create called without a `tools` field.
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("tools");
  });

  it("omits seed when no sampling overrides are given", async () => {
    mockCreate.mockReturnValueOnce(
      streamOf([textChunk("hi"), finishChunk("stop"), usageChunk(1, 1)]),
    );

    await collect(streamAgent(BASE));

    const call = mockCreate.mock.calls[0][0];
    expect(call).not.toHaveProperty("seed");
  });

  it("forwards seed into the completion call when provided", async () => {
    mockCreate.mockReturnValueOnce(
      streamOf([textChunk("hi"), finishChunk("stop"), usageChunk(1, 1)]),
    );

    await collect(streamAgent({ ...BASE, sampling: { seed: 12345 } }));

    const call = mockCreate.mock.calls[0][0];
    expect(call.seed).toBe(12345);
  });

  it("never forwards top_p — reasoning models reject a non-default value", async () => {
    mockCreate.mockReturnValueOnce(
      streamOf([textChunk("hi"), finishChunk("stop"), usageChunk(1, 1)]),
    );

    await collect(streamAgent({ ...BASE, sampling: { seed: 777 } }));

    const call = mockCreate.mock.calls[0][0];
    expect(call.seed).toBe(777);
    expect(call).not.toHaveProperty("top_p");
  });
});

describe("streamAgent (tool loop)", () => {
  it("runs get_meme, emits the meme, then streams the follow-up answer", async () => {
    // Round 0: model requests get_meme (arguments split across chunks).
    mockCreate.mockReturnValueOnce(
      streamOf([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", function: { name: "get_meme", arguments: '{"que' } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"party"}' } }] },
              finish_reason: null,
            },
          ],
        },
        finishChunk("tool_calls"),
        usageChunk(10, 2),
      ]),
    );
    // Round 1: the answer.
    mockCreate.mockReturnValueOnce(
      streamOf([textChunk("Lets go"), finishChunk("stop"), usageChunk(8, 5)]),
    );

    const runTool = jest
      .fn<Promise<ToolRunResult>, [{ name: string; arguments: string }]>()
      .mockResolvedValue({ content: '{"found":true}', meme: MEME });

    const deltas = await collect(streamAgent({ ...BASE, tools: TOOLS, runTool }));

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(runTool).toHaveBeenCalledWith({
      name: "get_meme",
      arguments: '{"query":"party"}',
    });

    expect(deltas).toEqual([
      { type: "meme", image: MEME },
      { type: "delta", text: "Lets go" },
      {
        type: "usage",
        // Summed across both completions.
        usage: {
          inputTokens: 18,
          cachedInputTokens: 0,
          outputTokens: 7,
          reasoningTokens: 0,
        },
      },
      { type: "done" },
    ]);

    // The second completion carries the assistant tool-call turn + tool result.
    const secondMessages = mockCreate.mock.calls[1][0].messages;
    const assistant = secondMessages.find(
      (m: { role: string }) => m.role === "assistant",
    );
    expect(assistant.tool_calls[0]).toMatchObject({
      id: "call_1",
      function: { name: "get_meme", arguments: '{"query":"party"}' },
    });
    const toolMsg = secondMessages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg).toMatchObject({ tool_call_id: "call_1", content: '{"found":true}' });
  });

  it("does not call the runner when the model answers without a tool", async () => {
    mockCreate.mockReturnValueOnce(
      streamOf([textChunk("plain answer"), finishChunk("stop"), usageChunk(5, 3)]),
    );
    const runTool = jest.fn();

    const deltas = await collect(streamAgent({ ...BASE, tools: TOOLS, runTool }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(runTool).not.toHaveBeenCalled();
    expect(deltas.some((d) => d.type === "meme")).toBe(false);
    // Tools were offered on the (only) round.
    expect(mockCreate.mock.calls[0][0]).toHaveProperty("tools");
  });

  it("surfaces an error delta when the OpenAI call throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("boom"));

    const deltas = await collect(streamAgent(BASE));
    expect(deltas).toEqual([{ type: "error", message: "boom" }]);
  });
});
