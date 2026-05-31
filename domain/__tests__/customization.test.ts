import {
  BACKGROUND_PRESETS,
  BACKGROUND_SURFACES,
  backgroundSwatches,
  bubbleSwatches,
  CUSTOM_SWATCH_ID,
  isBackgroundId,
  isBubbleStyleId,
  isDarkColor,
  makeCustomColorId,
  normalizeHex,
  parseCustomColor,
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
});

describe("resolveBackgroundSurface", () => {
  it("synthesizes a readable surface for a custom color", () => {
    const dark = resolveBackgroundSurface(makeCustomColorId("#101828"));
    expect(dark?.surfaceText).toBe(WHITE);
    const light = resolveBackgroundSurface(makeCustomColorId("#F2E9FF"));
    expect(light?.surfaceText).toBe(INK);
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
    // twilight is a dark gradient added in the second wave (generated surface).
    expect(resolveBackgroundSurface("twilight")?.surfaceText).toBe(WHITE);
    // coral is a light pastel added in the second wave.
    expect(resolveBackgroundSurface("coral")?.surfaceText).toBe(INK);
  });
});

describe("id validators", () => {
  it("accepts presets, auto, and custom colors", () => {
    expect(isBubbleStyleId("auto")).toBe(true);
    expect(isBubbleStyleId("violet")).toBe(true);
    expect(isBubbleStyleId("custom:#123456")).toBe(true);
    expect(isBackgroundId("twilight")).toBe(true);
    expect(isBackgroundId("custom:#abcdef")).toBe(true);
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
