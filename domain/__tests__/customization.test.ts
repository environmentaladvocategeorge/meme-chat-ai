import {
  BUBBLE_PRESETS,
  BACKGROUND_PRESETS,
  BACKGROUND_SURFACES,
  backgroundSwatches,
  bubbleSwatches,
  chatUiAccentTokens,
  CUSTOM_SWATCH_ID,
  isBackgroundId,
  isBubbleStyleId,
  isDarkColor,
  makeCustomColorId,
  makeCustomGradientId,
  normalizeHex,
  parseCustomColor,
  parseCustomGradient,
  readableGradientTextColor,
  readableTextColor,
  resolveBackground,
  resolveBackgroundSurface,
  resolveBubble,
} from "@/domain/customization";
import { themes } from "@/nativewind-theme";

const WHITE = "#FFFFFF";
const INK = "#17131F";

describe("normalizeHex", () => {
  it("uppercases and keeps 6-digit hex", () => {
    expect(normalizeHex("#7c3aed")).toBe("#7C3AED");
  });
  it("expands 3-digit shorthand", () => {
    expect(normalizeHex("#fff")).toBe("#FFFFFF");
    expect(normalizeHex("abc")).toBe("#AABBCC");
  });
  it("drops an alpha channel", () => {
    expect(normalizeHex("#11223344")).toBe("#112233");
  });
  it("rejects junk", () => {
    expect(normalizeHex("not-a-color")).toBeNull();
    expect(normalizeHex("#GGGGGG")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });
});

describe("parseCustomColor / makeCustomColorId", () => {
  it("round-trips a custom color", () => {
    const id = makeCustomColorId("#7c3aed");
    expect(id).toBe("custom:#7C3AED");
    expect(parseCustomColor(id)).toBe("#7C3AED");
  });
  it("returns null for presets and auto", () => {
    expect(parseCustomColor("auto")).toBeNull();
    expect(parseCustomColor("violet")).toBeNull();
  });
  it("returns null for a malformed custom value", () => {
    expect(parseCustomColor("custom:nope")).toBeNull();
    expect(parseCustomColor("custom:#xyz")).toBeNull();
  });
});

describe("parseCustomGradient / makeCustomGradientId", () => {
  it("round-trips a 2-stop gradient, omitting the default direction", () => {
    const id = makeCustomGradientId(["#00b4d8", "#00f5a0"]);
    // A default "down" gradient stays in the legacy byte-identical form.
    expect(id).toBe("custom-gradient:#00B4D8:#00F5A0");
    expect(parseCustomGradient(id)).toEqual({
      colors: ["#00B4D8", "#00F5A0"],
      direction: "down",
    });
  });

  it("round-trips a directional, 3-stop gradient", () => {
    const id = makeCustomGradientId(["#111111", "#222222", "#333333"], "right");
    expect(id).toBe("custom-gradient:r:#111111:#222222:#333333");
    expect(parseCustomGradient(id)).toEqual({
      colors: ["#111111", "#222222", "#333333"],
      direction: "right",
    });
  });

  it("parses a legacy 2-stop value as a default-down gradient", () => {
    expect(parseCustomGradient("custom-gradient:#123456:#abcdef")).toEqual({
      colors: ["#123456", "#ABCDEF"],
      direction: "down",
    });
  });

  it("returns null for malformed gradients", () => {
    expect(parseCustomGradient("custom-gradient:#123456")).toBeNull(); // 1 stop
    expect(parseCustomGradient("custom-gradient:#123456:#xyz")).toBeNull();
    expect(parseCustomGradient("custom-gradient:r:#123456")).toBeNull(); // dir + 1 stop
  });
});

describe("isDarkColor", () => {
  it("classifies by luminance", () => {
    expect(isDarkColor("#000000")).toBe(true);
    expect(isDarkColor("#FFFFFF")).toBe(false);
    expect(isDarkColor("#111827")).toBe(true);
    expect(isDarkColor("#FEF9C3")).toBe(false);
    expect(isDarkColor("#7C3AED")).toBe(true);
  });
});

describe("readableTextColor (contrast detection)", () => {
  it("uses white on dark fills and ink on light fills", () => {
    expect(readableTextColor("#000000")).toBe(WHITE);
    expect(readableTextColor("#7C3AED")).toBe(WHITE);
    expect(readableTextColor("#FFFFFF")).toBe(INK);
    expect(readableTextColor("#FEF08A")).toBe(INK);
  });
});

describe("readableGradientTextColor", () => {
  it("chooses the stronger on-color across both stops", () => {
    expect(readableGradientTextColor(["#00B4D8", "#00F5A0"])).toBe(INK);
    expect(readableGradientTextColor(["#5B21B6", "#BE185D"])).toBe(WHITE);
  });
});

describe("resolveBubble (custom)", () => {
  it("makes a solid bubble with auto-contrast text + overlays for a dark fill", () => {
    const b = resolveBubble(makeCustomColorId("#222222"), "light", themes.light);
    expect(b.kind).toBe("solid");
    expect(b.solidColor).toBe("#222222");
    expect(b.textColor).toBe(WHITE);
    // White text → white-based overlays.
    expect(b.codeBackgroundColor).toBe("rgba(255,255,255,0.16)");
    expect(b.borderColor).toBe("rgba(255,255,255,0.24)");
  });
  it("uses ink text + black overlays for a light fill", () => {
    const b = resolveBubble(makeCustomColorId("#EEEEEE"), "light", themes.light);
    expect(b.textColor).toBe(INK);
    expect(b.codeBackgroundColor).toBe("rgba(0,0,0,0.16)");
  });
  it("makes a custom two-color gradient bubble", () => {
    const b = resolveBubble(
      makeCustomGradientId(["#00B4D8", "#00F5A0"]),
      "light",
      themes.light,
    );
    expect(b.kind).toBe("gradient");
    expect(b.gradientColors).toEqual(["#00B4D8", "#00F5A0"]);
    expect(b.textColor).toBe(INK);
  });

  it("carries the gradient direction through to start/end points", () => {
    const b = resolveBubble(
      makeCustomGradientId(["#00B4D8", "#00F5A0"], "right"),
      "light",
      themes.light,
    );
    expect(b.gradientStart).toEqual({ x: 0, y: 0.5 });
    expect(b.gradientEnd).toEqual({ x: 1, y: 0.5 });
  });
});

describe("resolveBubble (presets)", () => {
  it("uses ink on bright neon gradients and white on deep gradients", () => {
    expect(resolveBubble("cyberMint", "light", themes.light).textColor).toBe(INK);
    expect(resolveBubble("electricNight", "light", themes.light).textColor).toBe(WHITE);
  });

  it("includes ten gradient bubble presets", () => {
    expect(BUBBLE_PRESETS.filter((p) => p.kind === "gradient")).toHaveLength(10);
  });
});

describe("chatUiAccentTokens", () => {
  it("derives chat primary tokens from an explicit accent color", () => {
    const accent = chatUiAccentTokens("#00B4D8");
    expect(accent["--color-primary"]).toBe("#00B4D8");
    expect(accent["--color-primary-foreground"]).toBe(INK);
    expect(accent["--color-ring"]).toBe("#00B4D8");
  });
});

describe("resolveBackground (custom)", () => {
  it("adopts a dark tone for a dark color", () => {
    const bg = resolveBackground(makeCustomColorId("#101828"), themes.light);
    expect(bg.kind).toBe("solid");
    expect(bg.color).toBe("#101828");
    expect(bg.tone).toBe("dark");
  });
  it("adopts a light tone for a light color", () => {
    const bg = resolveBackground(makeCustomColorId("#F2E9FF"), themes.light);
    expect(bg.tone).toBe("light");
  });
  it("supports a custom two-color gradient", () => {
    const bg = resolveBackground(
      makeCustomGradientId(["#0F172A", "#3730A3"]),
      themes.light,
    );
    expect(bg.kind).toBe("gradient");
    expect(bg.gradientColors).toEqual(["#0F172A", "#3730A3"]);
    expect(bg.tone).toBe("dark");
  });
});

describe("resolveBackgroundSurface", () => {
  it("synthesizes a readable surface for a custom color", () => {
    const dark = resolveBackgroundSurface(makeCustomColorId("#101828"));
    expect(dark?.surfaceText).toBe(WHITE);
    const light = resolveBackgroundSurface(makeCustomColorId("#F2E9FF"));
    expect(light?.surfaceText).toBe(INK);
  });
  it("synthesizes a readable surface for a custom gradient", () => {
    const dark = resolveBackgroundSurface(
      makeCustomGradientId(["#0F172A", "#3730A3"]),
    );
    expect(dark?.surfaceText).toBe(WHITE);
  });
  it("returns null for auto", () => {
    expect(resolveBackgroundSurface("auto")).toBeNull();
  });
  it("covers every background preset (no preset falls back to the stock card)", () => {
    for (const preset of BACKGROUND_PRESETS) {
      expect(BACKGROUND_SURFACES[preset.id]).toBeDefined();
    }
  });
  it("generated surfaces follow the preset's tone", () => {
    expect(resolveBackgroundSurface("deepSpace")?.surfaceText).toBe(WHITE);
    expect(resolveBackgroundSurface("popRocks")?.surfaceText).toBe(INK);
  });
});

describe("id validators", () => {
  it("accepts presets, auto, and custom colors", () => {
    expect(isBubbleStyleId("auto")).toBe(true);
    expect(isBubbleStyleId("violet")).toBe(true);
    expect(isBubbleStyleId("custom:#123456")).toBe(true);
    expect(isBubbleStyleId("custom-gradient:#00B4D8:#00F5A0")).toBe(true);
    expect(isBackgroundId("fuchsiaRush")).toBe(true);
    expect(isBackgroundId("custom:#abcdef")).toBe(true);
    expect(isBackgroundId("custom-gradient:#0F172A:#3730A3")).toBe(true);
  });
  it("rejects unknown and malformed values", () => {
    expect(isBubbleStyleId("garbage")).toBe(false);
    expect(isBackgroundId("custom:#xyz")).toBe(false);
    expect(isBackgroundId(CUSTOM_SWATCH_ID)).toBe(false); // bare sentinel isn't storable
  });
});

describe("swatch builders", () => {
  it("pin auto first and custom last", () => {
    const bubble = bubbleSwatches("light");
    const bg = backgroundSwatches(themes.light);
    expect(bubble[0].id).toBe("auto");
    expect(bubble[bubble.length - 1]).toEqual({
      id: CUSTOM_SWATCH_ID,
      kind: "custom",
    });
    expect(bg[0].id).toBe("auto");
    expect(bg[bg.length - 1]).toEqual({ id: CUSTOM_SWATCH_ID, kind: "custom" });
  });

  it("sort each hue family light → dark", () => {
    const ids = bubbleSwatches("light").map((s) => s.id);
    // Within the blue family the light pastel precedes the saturated one; same
    // for the violet family. (auto/custom are excluded from the sort.)
    expect(ids.indexOf("sky")).toBeLessThan(ids.indexOf("blue"));
    expect(ids.indexOf("lavender")).toBeLessThan(ids.indexOf("violet"));
  });
});
