/// <reference types="jest" />
import {
  buildDeciderContext,
  buildDeciderMessages,
  parseDecision,
} from "../decideMedia";
import type { ChatMessage } from "../types";

describe("buildDeciderContext", () => {
  it("annotates bot turns with the reaction sent and collects them to avoid repeats", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "yo" },
      {
        role: "agent",
        text: "what's good",
        gifs: [
          {
            id: "g1",
            source: "klipy-gif",
            url: "https://static.klipy.com/a.webp",
            previewUrl: "https://static.klipy.com/a.jpg",
            frameSourceUrl: "https://static.klipy.com/a-sm.webp",
            title: "rat dancing",
          },
        ],
      },
      { role: "user", text: "lol send another" },
    ];
    const { history, recentReactions } = buildDeciderContext(messages);
    expect(history).toContain("User: yo");
    expect(history).toContain("Bot: what's good [reaction sent: rat dancing]");
    expect(history).toContain("User: lol send another");
    expect(recentReactions).toEqual(["rat dancing"]);
  });

  it("collects klipy meme titles too, ignores untitled/uploaded images", () => {
    const messages: ChatMessage[] = [
      {
        role: "agent",
        text: "boom",
        images: [
          {
            id: "m1",
            source: "klipy",
            url: "https://static.klipy.com/m.webp",
            previewUrl: "https://static.klipy.com/m.jpg",
            title: "gigachad",
          },
        ],
      },
    ];
    const { recentReactions } = buildDeciderContext(messages);
    expect(recentReactions).toEqual(["gigachad"]);
  });

  it("annotates a user turn that sent a titled klipy meme, without adding it to do-not-repeat", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        text: "react to this",
        images: [
          {
            id: "m1",
            source: "klipy",
            url: "https://static.klipy.com/m.webp",
            previewUrl: "https://static.klipy.com/m.jpg",
            title: "gigachad",
          },
        ],
      },
    ];
    const { history, recentReactions } = buildDeciderContext(messages);
    expect(history).toContain("User: react to this [sent meme: gigachad]");
    // The user's own meme is context, not a bot reaction — it must NOT suppress
    // the decider from later picking that meme.
    expect(recentReactions).toEqual([]);
  });

  it("leaves user turns with untitled/uploaded attachments unannotated (back-compat)", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        text: "look",
        images: [
          {
            id: "m1",
            source: "klipy",
            url: "https://static.klipy.com/m.webp",
            previewUrl: "https://static.klipy.com/m.jpg",
          },
        ],
      },
    ];
    const { history } = buildDeciderContext(messages);
    expect(history).toBe("User: look");
  });

  it("handles empty history", () => {
    expect(buildDeciderContext([])).toEqual({
      history: "",
      recentReactions: [],
      recentMediaIds: [],
    });
  });
});

describe("buildDeciderMessages", () => {
  it("injects memory as a 2nd system message between the prompt and the user turn", () => {
    const msgs = buildDeciderMessages({
      systemPrompt: "DECIDER",
      memoryBlock: "TASTE",
      history: "",
      currentMessage: "yo",
    });
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: "system", content: "DECIDER" });
    expect(msgs[1]).toEqual({ role: "system", content: "TASTE" });
    expect(msgs[2].role).toBe("user");
  });

  it("omits the memory message when it's absent or blank", () => {
    expect(
      buildDeciderMessages({ systemPrompt: "D", history: "", currentMessage: "yo" }),
    ).toHaveLength(2);
    expect(
      buildDeciderMessages({
        systemPrompt: "D",
        memoryBlock: "   ",
        history: "",
        currentMessage: "yo",
      }),
    ).toHaveLength(2);
  });

  it("keeps the memory message alongside attachment pixels", () => {
    const msgs = buildDeciderMessages({
      systemPrompt: "D",
      memoryBlock: "TASTE",
      history: "",
      currentMessage: "",
      imageUrls: ["data:image/png;base64,xxx"],
    });
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toEqual({ role: "system", content: "TASTE" });
    expect(Array.isArray(msgs[2].content)).toBe(true);
  });

  it("embeds history, the current message, and the do-not-repeat list in the user turn", () => {
    const msgs = buildDeciderMessages({
      systemPrompt: "D",
      history: "User: hi",
      currentMessage: "lol",
      recentReactions: ["gigachad"],
    });
    const userMsg = msgs[msgs.length - 1];
    expect(typeof userMsg.content).toBe("string");
    expect(userMsg.content).toContain("User: hi");
    expect(userMsg.content).toContain("lol");
    expect(userMsg.content).toContain("gigachad");
  });
});

describe("parseDecision", () => {
  it("parses a gif decision with query + randomness", () => {
    const d = parseDecision('{"type":"gif","query":"rat dancing","randomness_factor":2}');
    expect(d).toEqual({ type: "gif", query: "rat dancing", randomnessFactor: 2 });
  });

  it("parses a meme decision", () => {
    const d = parseDecision('{"type":"meme","query":"gigachad","randomness_factor":1}');
    expect(d).toEqual({ type: "meme", query: "gigachad", randomnessFactor: 1 });
  });

  it("returns none for an explicit none", () => {
    expect(parseDecision('{"type":"none","query":null,"randomness_factor":null}')).toEqual({
      type: "none",
    });
  });

  it("defaults randomness to 1 when missing/out of range", () => {
    expect(parseDecision('{"type":"gif","query":"facepalm","randomness_factor":null}')).toEqual({
      type: "gif",
      query: "facepalm",
      randomnessFactor: 1,
    });
    expect(parseDecision('{"type":"gif","query":"facepalm","randomness_factor":31}')).toEqual({
      type: "gif",
      query: "facepalm",
      randomnessFactor: 1,
    });
    expect(parseDecision('{"type":"gif","query":"facepalm","randomness_factor":0}')).toEqual({
      type: "gif",
      query: "facepalm",
      randomnessFactor: 1,
    });
  });

  it("accepts the full 1-30 band — generic queries and chaos requests sample deep", () => {
    expect(
      parseDecision('{"type":"gif","query":"handshake","randomness_factor":18}'),
    ).toEqual({
      type: "gif",
      query: "handshake",
      randomnessFactor: 18,
    });
    expect(
      parseDecision('{"type":"gif","query":"random brainrot","randomness_factor":30}'),
    ).toEqual({
      type: "gif",
      query: "random brainrot",
      randomnessFactor: 30,
    });
  });

  it("falls back to none for a gif/meme with no usable query", () => {
    expect(parseDecision('{"type":"gif","query":"","randomness_factor":1}')).toEqual({
      type: "none",
    });
    expect(parseDecision('{"type":"gif","query":null,"randomness_factor":1}')).toEqual({
      type: "none",
    });
  });

  it("falls back to none for malformed JSON", () => {
    expect(parseDecision("not json at all")).toEqual({ type: "none" });
    expect(parseDecision("")).toEqual({ type: "none" });
  });

  it("clamps an over-long query", () => {
    const long = "x".repeat(200);
    const d = parseDecision(`{"type":"gif","query":"${long}","randomness_factor":1}`);
    expect(d.type).toBe("gif");
    if (d.type === "gif") expect(d.query.length).toBe(100);
  });
});
