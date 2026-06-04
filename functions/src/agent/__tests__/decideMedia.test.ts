import { buildDeciderContext, parseDecision } from "../decideMedia";
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

  it("handles empty history", () => {
    expect(buildDeciderContext([])).toEqual({ history: "", recentReactions: [] });
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
    expect(parseDecision('{"type":"gif","query":"facepalm","randomness_factor":9}')).toEqual({
      type: "gif",
      query: "facepalm",
      randomnessFactor: 1,
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
