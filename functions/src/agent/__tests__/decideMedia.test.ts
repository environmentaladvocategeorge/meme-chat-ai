/// <reference types="jest" />
import {
  buildDeciderContext,
  buildDeciderMessages,
  computeColdStartIndex,
  GREETING_BANK_SIZE,
  isBareGreeting,
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

  it("handles empty history", () => {
    expect(buildDeciderContext([])).toEqual({ history: "", recentReactions: [] });
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

describe("isBareGreeting — positive cases", () => {
  for (const [input, label] of [
    // Original set
    ["hi", "hi"],
    ["Hi", "uppercase first letter"],
    ["HEY", "all caps"],
    ["yo", "yo"],
    ["yooo", "repeated trailing o"],
    ["heyyy", "repeated trailing y"],
    ["wsg", "wsg"],
    ["gm", "gm"],
    ["sup", "sup"],
    ["wassup", "wassup"],
    ["what's good", "what's good with apostrophe"],
    ["hi!", "trailing exclamation"],
    ["hey!!", "trailing double exclamation"],
    ["  hello  ", "leading and trailing whitespace"],
    ["yo 👋", "trailing emoji"],
    ["sup?", "trailing question mark — bare sup"],
    ["hiya", "hiya"],
    ["heyo", "heyo"],
    ["ello", "ello"],
    // Expanded set (demographic openers)
    ["ayo", "ayo"],
    ["ay", "ay"],
    ["eyy", "eyy"],
    ["howdy", "howdy"],
    ["henlo", "henlo"],
    ["hai", "hai"],
    ["wagwan", "wagwan"],
    ["oi", "oi"],
    // Leading emoji (new: strip leading non-word chars too)
    ["👋 hi", "leading emoji then greeting"],
    ["👋hi", "leading emoji attached to greeting"],
    // Doubled bare greetings
    ["hi hi", "doubled hi — still bare greeting"],
    ["yo yo", "doubled yo — still bare greeting"],
  ] as [string, string][]) {
    it(`returns true for "${input}" (${label})`, () => {
      expect(isBareGreeting(input)).toBe(true);
    });
  }
});

describe("isBareGreeting — negative cases", () => {
  for (const [input, label] of [
    // Content after greeting
    ["hi can you help me", "greeting followed by content"],
    ["hello there general kenobi", "multi-word non-greeting phrase — intentional Obi-Wan exclusion"],
    ["gm what's the move today", "greeting followed by content"],
    ["yo rank these albums", "greeting + content"],
    // Empty / whitespace
    ["", "empty string"],
    ["   ", "whitespace only"],
    // Substring traps (whole-string match, not substring)
    ["high", "hi inside high"],
    ["history", "longer word containing hi"],
    ["supreme", "unrelated word containing sup"],
    // Long content
    ["hello how do mortgages work", "greeting + long content"],
    // Emoji without greeting
    ["💀💀", "pure emoji with no greeting"],
    // Content after single-word look-alike
    ["sup with the weather", "sup + content"],
    // Multi-language — excluded by design (let decider handle)
    ["hola", "Spanish greeting — excluded by design"],
  ] as [string, string][]) {
    it(`returns false for "${input}" (${label})`, () => {
      expect(isBareGreeting(input)).toBe(false);
    });
  }
});

describe("buildDeciderMessages — coldStartIndex injection", () => {
  const base = { systemPrompt: "SYS", history: "", currentMessage: "hi" };

  it("appends binding tag when coldStartIndex is 4", () => {
    const msgs = buildDeciderMessages({ ...base, coldStartIndex: 4 });
    const userContent = msgs[msgs.length - 1].content as string;
    expect(userContent).toContain("[cold-start: pick greeting option 4");
    expect(userContent).toContain("treat as binding");
  });

  it("appends binding tag when coldStartIndex is 0 (falsy-zero guard)", () => {
    const msgs = buildDeciderMessages({ ...base, coldStartIndex: 0 });
    const userContent = msgs[msgs.length - 1].content as string;
    expect(userContent).toContain("[cold-start: pick greeting option 0");
  });

  it("coldStartIndex: undefined produces byte-identical output to omitting the param (snapshot test)", () => {
    const withUndefined = buildDeciderMessages({ ...base, coldStartIndex: undefined });
    const withoutParam = buildDeciderMessages(base);
    expect(JSON.stringify(withUndefined)).toBe(JSON.stringify(withoutParam));
  });

  it("does not inject the tag when coldStartIndex is undefined", () => {
    const msgs = buildDeciderMessages(base);
    const userContent = msgs[msgs.length - 1].content as string;
    expect(userContent).not.toContain("[cold-start:");
  });
});

describe("computeColdStartIndex", () => {
  it("returns a number in [0, GREETING_BANK_SIZE) for a first-turn bare greeting with no media", () => {
    const idx = computeColdStartIndex({
      isFirstTurn: true,
      hasImages: false,
      hasGifs: false,
      userText: "hi",
    });
    expect(typeof idx).toBe("number");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(GREETING_BANK_SIZE);
  });

  it("returns undefined for a first-turn bare greeting when an image is attached", () => {
    expect(
      computeColdStartIndex({
        isFirstTurn: true,
        hasImages: true,
        hasGifs: false,
        userText: "hi",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a first-turn bare greeting when a GIF is attached", () => {
    expect(
      computeColdStartIndex({
        isFirstTurn: true,
        hasImages: false,
        hasGifs: true,
        userText: "hi",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a content message on the first turn", () => {
    expect(
      computeColdStartIndex({
        isFirstTurn: true,
        hasImages: false,
        hasGifs: false,
        userText: "yo rank the new Kendrick album",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a bare greeting mid-conversation (second turn)", () => {
    expect(
      computeColdStartIndex({
        isFirstTurn: false,
        hasImages: false,
        hasGifs: false,
        userText: "hi",
      }),
    ).toBeUndefined();
  });

  it("uses Math.floor(Math.random() * GREETING_BANK_SIZE) for index computation", () => {
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.5);
    const idx = computeColdStartIndex({
      isFirstTurn: true,
      hasImages: false,
      hasGifs: false,
      userText: "yo",
    });
    expect(idx).toBe(Math.floor(0.5 * GREETING_BANK_SIZE));
    spy.mockRestore();
  });

  it("never returns GREETING_BANK_SIZE itself (off-by-one guard)", () => {
    // Math.random() returns values in [0, 1); Math.floor(x * N) is in [0, N-1]
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.9999999);
    const idx = computeColdStartIndex({
      isFirstTurn: true,
      hasImages: false,
      hasGifs: false,
      userText: "hi",
    });
    expect(idx).toBeLessThan(GREETING_BANK_SIZE);
    spy.mockRestore();
  });

  it("produces a uniform-enough distribution over 10000 cold-start draws", () => {
    const counts = Array<number>(GREETING_BANK_SIZE).fill(0);
    for (let i = 0; i < 10000; i++) {
      const idx = computeColdStartIndex({
        isFirstTurn: true,
        hasImages: false,
        hasGifs: false,
        userText: "hi",
      })!;
      counts[idx]++;
    }
    const expected = 10000 / GREETING_BANK_SIZE;
    // Each bucket should land within ±30% of expected (extremely conservative
    // for Math.random — catches real off-by-one pool truncation)
    for (const count of counts) {
      expect(count).toBeGreaterThan(expected * 0.7);
      expect(count).toBeLessThan(expected * 1.3);
    }
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
