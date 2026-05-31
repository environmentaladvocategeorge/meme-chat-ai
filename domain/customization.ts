// Chat appearance customization — a paid "App Customization" feature.
//
// These presets are LOCAL-ONLY (persisted in AsyncStorage via SettingsStorage,
// never synced to the backend) and intentionally theme-agnostic: once a user
// picks a concrete style it stays put regardless of the app's light/dark mode.
// The special "auto" id is the only theme-reactive value — it's the default and
// falls back to the live theme's gradient/background, so a user who never opens
// the picker keeps the stock look that tracks light/dark.
//
// The feature is gated to paid plans; see useChatAppearance, which forces
// "auto" for free users so a downgrade gracefully reverts the look without us
// having to mutate stored preferences.

import { gradients, type ThemeTokens } from "@/nativewind-theme";

export type ColorScheme = "light" | "dark";
type Theme = ThemeTokens;

const AUTO_ID = "auto" as const;

type GradientStops = readonly [string, string, ...string[]];

// ---- Message bubble styles (applied to the user's own bubbles) ----

type BubblePreset =
  | { id: string; kind: "gradient"; colors: GradientStops; textColor: string }
  | { id: string; kind: "solid"; color: string; textColor: string };

const WHITE = "#FFFFFF";
const INK = "#17131F";

// ---- Color math (pure, no theme) ----
//
// Small self-contained helpers so a fully-custom color the user picks can be
// turned into a coherent set of UI colors WITHOUT a color library at runtime.
// Everything here works on #rgb / #rrggbb / #rrggbbaa hex strings.

type RGB = { r: number; g: number; b: number };

export function hexToRgb(hex: string): RGB | null {
  let c = hex.trim().replace(/^#/, "");
  if (c.length === 3) {
    c = c
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (c.length === 8) c = c.slice(0, 6); // drop an alpha channel if present
  if (c.length !== 6 || /[^0-9a-fA-F]/.test(c)) return null;
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

function toHex2(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, "0").toUpperCase();
}

function rgbToHex({ r, g, b }: RGB): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

// Normalize any accepted hex to canonical #RRGGBB (uppercase, no alpha), or
// null if it isn't a parseable color.
export function normalizeHex(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb) : null;
}

// Linear blend of two colors. t=0 → a, t=1 → b.
function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  });
}

// Append an 8-bit alpha to a #rrggbb color (RN understands #RRGGBBAA).
function withAlpha(hex: string, alpha: number): string {
  const base = normalizeHex(hex) ?? "#000000";
  return `${base}${toHex2(alpha * 255)}`;
}

// WCAG relative luminance — the perceptually-correct basis for contrast, so the
// "what text/chrome reads well on this color" decision is principled rather
// than eyeballed.
function srgbToLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 1; // unknown → treat as light so we fall back to dark text
  return (
    0.2126 * srgbToLinear(rgb.r) +
    0.7152 * srgbToLinear(rgb.g) +
    0.0722 * srgbToLinear(rgb.b)
  );
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// True when a surface is dark enough that the chat should adopt dark-mode
// chrome (and light text) on top of it.
export function isDarkColor(hex: string): boolean {
  return relativeLuminance(hex) < 0.5;
}

// The on-color (white or ink) with the better contrast against `hex`. This is
// the "detect the contrast color" the custom picker relies on so a user's
// hand-picked fill never ships unreadable text.
export function readableTextColor(hex: string): string {
  return contrastRatio(hex, WHITE) >= contrastRatio(hex, INK) ? WHITE : INK;
}

// ---- Custom (user-picked) colors ----
//
// A custom pick is stored inline as `custom:#RRGGBB` so it rides through the
// same string setting as the presets (no schema change), while staying easy to
// detect and validate. The resolve functions below special-case it and derive
// every dependent color from it via the contrast helpers above.
const CUSTOM_PREFIX = "custom:";

export function makeCustomColorId(hex: string): string {
  return `${CUSTOM_PREFIX}${normalizeHex(hex) ?? "#000000"}`;
}

export function parseCustomColor(id: string): string | null {
  if (!id.startsWith(CUSTOM_PREFIX)) return null;
  return normalizeHex(id.slice(CUSTOM_PREFIX.length));
}

// Order here is the order shown in the picker (after the leading "Auto" swatch):
// gradients, then pastels (ink text), then basics (saturated, white text). Eight
// of each — a curated, evenly-grouped set rather than a long similar-looking row.
export const BUBBLE_PRESETS: readonly BubblePreset[] = [
  // Gradients — white text stays legible across the whole sweep.
  { id: "violetPink", kind: "gradient", colors: ["#7C3AED", "#DB2777"], textColor: WHITE },
  { id: "blueCyan", kind: "gradient", colors: ["#2563EB", "#06B6D4"], textColor: WHITE },
  { id: "sunset", kind: "gradient", colors: ["#F97316", "#EC4899"], textColor: WHITE },
  { id: "purpleBlue", kind: "gradient", colors: ["#8B5CF6", "#2563EB"], textColor: WHITE },
  { id: "greenTeal", kind: "gradient", colors: ["#16A34A", "#14B8A6"], textColor: WHITE },
  { id: "roseRed", kind: "gradient", colors: ["#F43F5E", "#DC2626"], textColor: WHITE },
  { id: "indigoViolet", kind: "gradient", colors: ["#4F46E5", "#7C3AED"], textColor: WHITE },
  { id: "slateBlue", kind: "gradient", colors: ["#334155", "#2563EB"], textColor: WHITE },
  // Pastels — soft fills, so they carry dark ink text.
  { id: "lavender", kind: "solid", color: "#EDE9FE", textColor: INK },
  { id: "sky", kind: "solid", color: "#DBEAFE", textColor: INK },
  { id: "blush", kind: "solid", color: "#FCE7F3", textColor: INK },
  { id: "mint", kind: "solid", color: "#CCFBF1", textColor: INK },
  { id: "sage", kind: "solid", color: "#DCFCE7", textColor: INK },
  { id: "peach", kind: "solid", color: "#FFEDD5", textColor: INK },
  { id: "rose", kind: "solid", color: "#FFE4E6", textColor: INK },
  { id: "sand", kind: "solid", color: "#FEF3C7", textColor: INK },
  // Basics — saturated UI colors, white text.
  { id: "violet", kind: "solid", color: "#7C3AED", textColor: WHITE },
  { id: "blue", kind: "solid", color: "#2563EB", textColor: WHITE },
  { id: "pink", kind: "solid", color: "#DB2777", textColor: WHITE },
  { id: "teal", kind: "solid", color: "#0D9488", textColor: WHITE },
  { id: "green", kind: "solid", color: "#16A34A", textColor: WHITE },
  { id: "orange", kind: "solid", color: "#EA580C", textColor: WHITE },
  { id: "red", kind: "solid", color: "#DC2626", textColor: WHITE },
  { id: "graphite", kind: "solid", color: "#1F2937", textColor: WHITE },
];

// ---- Chat backgrounds ----

// `tone` declares whether this is a light or dark surface. The chat view adopts
// that tone for ALL of its other elements (agent bubbles, header, composer,
// text) so nothing fights the background — see useChatAppearance.
type BackgroundPreset =
  | { id: string; kind: "solid"; color: string; tone: ColorScheme }
  | { id: string; kind: "gradient"; colors: GradientStops; tone: ColorScheme };

export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = [
  // Gradients (vertical, subtle — they sit behind the whole thread), ordered
  // after the leading "Auto" swatch: airy light sweeps first, then a richer set
  // of deep "night" gradients.
  { id: "dawn", kind: "gradient", colors: ["#FFF7ED", "#EEF2FF"], tone: "light" },
  { id: "cotton", kind: "gradient", colors: ["#FDF2F8", "#E0F2FE"], tone: "light" },
  { id: "aurora", kind: "gradient", colors: ["#ECFDF5", "#EEF2FF"], tone: "light" },
  { id: "lilac", kind: "gradient", colors: ["#F5F3FF", "#FCE7F3"], tone: "light" },
  { id: "sunset", kind: "gradient", colors: ["#FFEDD5", "#FFE4E6"], tone: "light" },
  { id: "ocean", kind: "gradient", colors: ["#E0F2FE", "#CCFBF1"], tone: "light" },
  { id: "peachy", kind: "gradient", colors: ["#FFE4E6", "#FFF1E6"], tone: "light" },
  { id: "seafoam", kind: "gradient", colors: ["#D1FAE5", "#CFFAFE"], tone: "light" },
  { id: "grape", kind: "gradient", colors: ["#EDE9FE", "#FAE8FF"], tone: "light" },
  { id: "skyfade", kind: "gradient", colors: ["#DBEAFE", "#EDE9FE"], tone: "light" },
  { id: "dusk", kind: "gradient", colors: ["#312E81", "#111827"], tone: "dark" },
  { id: "midnight", kind: "gradient", colors: ["#0F172A", "#312E81"], tone: "dark" },
  { id: "twilight", kind: "gradient", colors: ["#1E1B4B", "#581C87"], tone: "dark" },
  { id: "forest", kind: "gradient", colors: ["#064E3B", "#022C22"], tone: "dark" },
  { id: "ember", kind: "gradient", colors: ["#7F1D1D", "#431407"], tone: "dark" },
  { id: "blossom", kind: "gradient", colors: ["#FFE4F0", "#F3E8FF"], tone: "light" },
  { id: "sherbet", kind: "gradient", colors: ["#FEF3C7", "#FFE0E9"], tone: "light" },
  { id: "lagoon", kind: "gradient", colors: ["#CFFAFE", "#DBEAFE"], tone: "light" },
  { id: "meadow", kind: "gradient", colors: ["#DCFCE7", "#FEF9C3"], tone: "light" },
  { id: "bubblegum", kind: "gradient", colors: ["#FBCFE8", "#DDD6FE"], tone: "light" },
  { id: "creamsicle", kind: "gradient", colors: ["#FFE8CC", "#FEF9C3"], tone: "light" },
  { id: "cosmos", kind: "gradient", colors: ["#1E1B4B", "#0F172A"], tone: "dark" },
  { id: "wine", kind: "gradient", colors: ["#4A0E26", "#1A0F14"], tone: "dark" },
  { id: "deepsea", kind: "gradient", colors: ["#082F49", "#042F2E"], tone: "dark" },
  { id: "aubergine", kind: "gradient", colors: ["#2E1065", "#3B0764"], tone: "dark" },
  // Pastels — gentle full-surface tints (all light).
  { id: "lavender", kind: "solid", color: "#F5F3FF", tone: "light" },
  { id: "sky", kind: "solid", color: "#EFF6FF", tone: "light" },
  { id: "blush", kind: "solid", color: "#FDF2F8", tone: "light" },
  { id: "mint", kind: "solid", color: "#ECFDF5", tone: "light" },
  { id: "sage", kind: "solid", color: "#F0FDF4", tone: "light" },
  { id: "peach", kind: "solid", color: "#FFF7ED", tone: "light" },
  { id: "butter", kind: "solid", color: "#FEFCE8", tone: "light" },
  { id: "stone", kind: "solid", color: "#F8FAFC", tone: "light" },
  { id: "coral", kind: "solid", color: "#FFE4E0", tone: "light" },
  { id: "lemon", kind: "solid", color: "#FEF9C3", tone: "light" },
  { id: "cyan", kind: "solid", color: "#CFFAFE", tone: "light" },
  { id: "indigo", kind: "solid", color: "#E0E7FF", tone: "light" },
  { id: "fuchsia", kind: "solid", color: "#FAE8FF", tone: "light" },
  { id: "apricot", kind: "solid", color: "#FFE3C7", tone: "light" },
  { id: "pistachio", kind: "solid", color: "#E8F3CC", tone: "light" },
  { id: "periwinkle", kind: "solid", color: "#DCE0FF", tone: "light" },
  { id: "flamingo", kind: "solid", color: "#FFD6E4", tone: "light" },
  { id: "seaglass", kind: "solid", color: "#CFEFE6", tone: "light" },
  { id: "wisteria", kind: "solid", color: "#E7DAF7", tone: "light" },
  // Basics — muted UI colors, soft enough to read as full backgrounds.
  { id: "violet", kind: "solid", color: "#EDE9FE", tone: "light" },
  { id: "blue", kind: "solid", color: "#DBEAFE", tone: "light" },
  { id: "pink", kind: "solid", color: "#FCE7F3", tone: "light" },
  { id: "teal", kind: "solid", color: "#CCFBF1", tone: "light" },
  { id: "green", kind: "solid", color: "#DCFCE7", tone: "light" },
  { id: "orange", kind: "solid", color: "#FFEDD5", tone: "light" },
  { id: "red", kind: "solid", color: "#FFE4E6", tone: "light" },
  // Deep solids — richer "night" surfaces for users who want a dark thread.
  { id: "graphite", kind: "solid", color: "#111827", tone: "dark" },
  { id: "plum", kind: "solid", color: "#241733", tone: "dark" },
  { id: "navy", kind: "solid", color: "#0E1A30", tone: "dark" },
  { id: "pine", kind: "solid", color: "#0C2A22", tone: "dark" },
  { id: "espresso", kind: "solid", color: "#211613", tone: "dark" },
  { id: "charcoal", kind: "solid", color: "#1C1C28", tone: "dark" },
  { id: "oxblood", kind: "solid", color: "#330A16", tone: "dark" },
  { id: "deepteal", kind: "solid", color: "#062A2E", tone: "dark" },
  { id: "slateblue", kind: "solid", color: "#16243A", tone: "dark" },
];

// Valid preset ids (including "auto"). Custom values aren't enumerable, so
// storage validation goes through the isBubbleStyleId / isBackgroundId guards
// below rather than membership in these arrays.
export const BUBBLE_STYLE_IDS: readonly string[] = [
  AUTO_ID,
  ...BUBBLE_PRESETS.map((p) => p.id),
];
export const BACKGROUND_IDS: readonly string[] = [
  AUTO_ID,
  ...BACKGROUND_PRESETS.map((p) => p.id),
];

const BUBBLE_STYLE_SET = new Set<string>(BUBBLE_STYLE_IDS);
const BACKGROUND_SET = new Set<string>(BACKGROUND_IDS);

// A stored value is valid if it's a known preset OR a well-formed custom color.
export function isBubbleStyleId(id: string): boolean {
  return BUBBLE_STYLE_SET.has(id) || parseCustomColor(id) !== null;
}
export function isBackgroundId(id: string): boolean {
  return BACKGROUND_SET.has(id) || parseCustomColor(id) !== null;
}

export const DEFAULT_BUBBLE_STYLE = AUTO_ID;
export const DEFAULT_BACKGROUND = AUTO_ID;

// ---- Resolution ----

export type ResolvedBubble = {
  kind: "gradient" | "solid";
  gradientColors: GradientStops | null;
  solidColor: string | null;
  textColor: string;
  // Overlay tints derived from how dark the text is, so inline code blocks and
  // borders inside a custom bubble stay visible on light AND dark fills.
  codeBackgroundColor: string;
  borderColor: string;
};

export type ResolvedBackground = {
  kind: "solid" | "gradient";
  color: string | null;
  gradientColors: GradientStops | null;
  // The tone the rest of the chat should adopt. null => follow the app's
  // global light/dark scheme (the "auto" default).
  tone: ColorScheme | null;
};

function overlaysFor(textColor: string): {
  codeBackgroundColor: string;
  borderColor: string;
} {
  // Dark text means the bubble fill is light → overlay with black; otherwise
  // (white text on a colored/dark fill) overlay with white, matching the stock
  // gradient bubble's existing rgba(255,255,255,…) treatment.
  const base = isDarkColor(textColor) ? "0,0,0" : "255,255,255";
  return {
    codeBackgroundColor: `rgba(${base},0.16)`,
    borderColor: `rgba(${base},0.24)`,
  };
}

export function resolveBubble(
  id: string,
  scheme: ColorScheme,
  theme: Theme,
): ResolvedBubble {
  if (id === AUTO_ID) {
    const textColor = theme["--color-primary-foreground"];
    return {
      kind: "gradient",
      gradientColors: gradients[scheme].primary.colors,
      solidColor: null,
      textColor,
      ...overlaysFor(textColor),
    };
  }

  // Fully-custom solid fill: pick the readable on-color automatically so the
  // user can't land an unreadable bubble, and derive the code/border overlays
  // from that same decision.
  const custom = parseCustomColor(id);
  if (custom) {
    const textColor = readableTextColor(custom);
    return {
      kind: "solid",
      gradientColors: null,
      solidColor: custom,
      textColor,
      ...overlaysFor(textColor),
    };
  }

  const preset = BUBBLE_PRESETS.find((p) => p.id === id);
  if (!preset) return resolveBubble(AUTO_ID, scheme, theme);

  if (preset.kind === "gradient") {
    return {
      kind: "gradient",
      gradientColors: preset.colors,
      solidColor: null,
      textColor: preset.textColor,
      ...overlaysFor(preset.textColor),
    };
  }

  return {
    kind: "solid",
    gradientColors: null,
    solidColor: preset.color,
    textColor: preset.textColor,
    ...overlaysFor(preset.textColor),
  };
}

export function resolveBackground(
  id: string,
  theme: Theme,
): ResolvedBackground {
  if (id === AUTO_ID) {
    return {
      kind: "solid",
      color: theme["--color-background"],
      gradientColors: null,
      tone: null,
    };
  }

  // Fully-custom solid background: its luminance decides the tone the rest of
  // the chat adopts (dark color → dark chrome, light color → light chrome), so
  // the surrounding UI never fights the backdrop.
  const custom = parseCustomColor(id);
  if (custom) {
    return {
      kind: "solid",
      color: custom,
      gradientColors: null,
      tone: isDarkColor(custom) ? "dark" : "light",
    };
  }

  const preset = BACKGROUND_PRESETS.find((p) => p.id === id);
  if (!preset) return resolveBackground(AUTO_ID, theme);

  if (preset.kind === "gradient") {
    return {
      kind: "gradient",
      color: null,
      gradientColors: preset.colors,
      tone: preset.tone,
    };
  }
  return {
    kind: "solid",
    color: preset.color,
    gradientColors: null,
    tone: preset.tone,
  };
}

// ---- Per-background chat surfaces ----
//
// A custom background changes more than the backdrop. The "assistant surface"
// family — agent bubble, chat bar, header card, upgrade card, composer chips —
// must sit ON that background with good contrast instead of keeping the stock
// dark-purple card (which only looks right because the default background is
// dark purple). Each background declares the surface its chrome should adopt:
//
//   surface       — agent bubble / chat bar / cards / chips fill
//   surfaceText   — text + solid glyphs on that surface
//   surfaceBorder — hairline outline
//   surfaceMuted  — secondary icons / placeholder / helper text
//
// Light backgrounds use a frosted translucent white for the iOS layered-card
// look; dark backgrounds use a tint from their own family so dark mode isn't
// forced to look purple. The user's own message bubble is deliberately NOT part
// of this — it stays bright and personal (see ResolvedBubble). "auto" has no
// entry and keeps the stock theme card, matching the default look that tracks
// light/dark. Keys mirror BACKGROUND_PRESETS ids; this is the single place to
// retune how chrome adapts to each background.
export type ChatSurface = {
  surface: string;
  surfaceText: string;
  surfaceBorder: string;
  surfaceMuted: string;
};

// Frosted translucent white shared by every light background (CC ≈ 80% alpha,
// so the chosen background tints through for the layered-card look).
const FROSTED = "#FFFFFFCC";

// Synthesizes a coherent chat surface from a single background color + tone.
// This is the contrast engine behind BOTH the fully-custom color and the newer
// presets (whose surfaces are generated rather than hand-tuned), so a colored
// backdrop always gets readable, on-brand chrome.
function tunedSurface(base: string, tone: ColorScheme): ChatSurface {
  if (tone === "dark") {
    return {
      // Lift the card slightly off a dark backdrop so it reads as a layer.
      surface: withAlpha(mix(base, WHITE, 0.12), 0.82),
      surfaceText: WHITE,
      surfaceBorder: withAlpha(mix(base, WHITE, 0.34), 0.4),
      surfaceMuted: mix(WHITE, base, 0.32),
    };
  }
  return {
    surface: FROSTED,
    surfaceText: INK,
    // A translucent, slightly-darkened tint of the background hue — visible on
    // the frosted white card without hardening into a line.
    surfaceBorder: withAlpha(mix(base, INK, 0.22), 0.5),
    surfaceMuted: mix(INK, WHITE, 0.42),
  };
}

// The surface for a fully-custom color: tone is decided by its luminance, then
// the whole chrome family is synthesized to read well on it.
function customSurface(hex: string): ChatSurface {
  return tunedSurface(hex, isDarkColor(hex) ? "dark" : "light");
}

// A single color that represents a background for surface synthesis — the fill
// for a solid, or the midpoint of a gradient's stops.
function representativeColor(preset: BackgroundPreset): string {
  return preset.kind === "solid"
    ? preset.color
    : mix(preset.colors[0], preset.colors[1], 0.5);
}

// Hand-tuned surfaces for the original presets — kept verbatim so their look is
// pixel-stable. Newer presets are NOT listed here; their surfaces are generated
// below from the background color via tunedSurface, so adding a preset is a
// one-line change to BACKGROUND_PRESETS.
const TUNED_SURFACES: Readonly<Record<string, ChatSurface>> = {
  // Gradients
  dawn: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#FED7AA66", surfaceMuted: "#7C6F64" },
  cotton: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#C7D2FE66", surfaceMuted: "#6B7280" },
  aurora: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#A7F3D066", surfaceMuted: "#64748B" },
  lilac: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#DDD6FE80", surfaceMuted: "#75677E" },
  sunset: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#FDA4AF66", surfaceMuted: "#7C5E5E" },
  ocean: { surface: "#F8FAFCCC", surfaceText: INK, surfaceBorder: "#BAE6FD66", surfaceMuted: "#52717A" },
  dusk: { surface: "#19142ACC", surfaceText: WHITE, surfaceBorder: "#6D5DAA55", surfaceMuted: "#B8B0CC" },
  midnight: { surface: "#151827CC", surfaceText: WHITE, surfaceBorder: "#4F46E555", surfaceMuted: "#B7BCE0" },
  // Pastels
  lavender: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#DDD6FE80", surfaceMuted: "#6D647A" },
  sky: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#BFDBFE80", surfaceMuted: "#5D6F86" },
  blush: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#FBCFE880", surfaceMuted: "#806575" },
  mint: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#A7F3D080", surfaceMuted: "#58776A" },
  sage: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#BBF7D080", surfaceMuted: "#5F735F" },
  peach: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#FED7AA80", surfaceMuted: "#826A55" },
  butter: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#FEF08A80", surfaceMuted: "#766F4A" },
  stone: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#CBD5E180", surfaceMuted: "#64748B" },
  // Basics
  violet: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#C4B5FD80", surfaceMuted: "#6D647A" },
  blue: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#93C5FD80", surfaceMuted: "#526A88" },
  pink: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#F9A8D480", surfaceMuted: "#806575" },
  teal: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#99F6E480", surfaceMuted: "#50766F" },
  green: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#86EFAC80", surfaceMuted: "#57745D" },
  orange: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#FDBA7480", surfaceMuted: "#826A55" },
  red: { surface: FROSTED, surfaceText: INK, surfaceBorder: "#FDA4AF80", surfaceMuted: "#7C5E5E" },
  graphite: { surface: "#1F2937CC", surfaceText: WHITE, surfaceBorder: "#47556966", surfaceMuted: "#CBD5E1" },
};

// Surfaces for every preset NOT in TUNED_SURFACES, synthesized from the
// background color so the second-wave presets stay consistent with the
// fully-custom path without bespoke tuning.
const GENERATED_SURFACES: Record<string, ChatSurface> = Object.fromEntries(
  BACKGROUND_PRESETS.filter((p) => !(p.id in TUNED_SURFACES)).map((p) => [
    p.id,
    tunedSurface(representativeColor(p), p.tone),
  ]),
);

export const BACKGROUND_SURFACES: Readonly<Record<string, ChatSurface>> = {
  ...TUNED_SURFACES,
  ...GENERATED_SURFACES,
};

// The surface a given background id maps its chat chrome to, or null for "auto"
// / unknown ids (keep the stock theme card that tracks light/dark). A custom
// color synthesizes its surface on the fly via the contrast engine.
export function resolveBackgroundSurface(id: string): ChatSurface | null {
  const custom = parseCustomColor(id);
  if (custom) return customSurface(custom);
  return BACKGROUND_SURFACES[id] ?? null;
}

// ---- Swatch helpers (for the settings picker) ----

// Sentinel id for the trailing "pick your own" swatch. Distinct from a stored
// custom value (which is `custom:#RRGGBB`): tapping this swatch opens the color
// picker rather than committing a value, so the picker treats it specially.
export const CUSTOM_SWATCH_ID = "custom";

export type Swatch =
  | { id: string; kind: "gradient"; colors: GradientStops }
  | { id: string; kind: "solid"; colors: readonly [string] }
  | { id: string; kind: "custom" };

// ---- Palette ordering ----
//
// The picker is sorted into color families: chromatic swatches grouped by hue
// (red → magenta around the wheel), then near-neutrals, with each family
// running light → dark. A gradient is sorted by the midpoint of its stops. The
// leading "auto" swatch and trailing "custom" swatch are excluded — they stay
// pinned at the ends.

// Bin width in degrees for grouping hues into families (12 bins around 360°).
const HUE_BIN = 30;

function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

// The single color a swatch sorts by: a solid's fill, or a gradient's midpoint.
function swatchSortColor(s: Swatch): string | null {
  if (s.kind === "solid") return s.colors[0];
  if (s.kind === "gradient") {
    return mix(s.colors[0], s.colors[s.colors.length - 1], 0.5);
  }
  return null;
}

// Orders presets by (family, light → dark). True neutrals (very low saturation)
// are pushed to the end as their own family.
function sortPalette(swatches: readonly Swatch[]): Swatch[] {
  const key = (s: Swatch) => {
    const hex = swatchSortColor(s);
    const rgb = hex ? hexToRgb(hex) : null;
    if (!rgb) return { neutral: 1, bin: 0, light: 0 };
    const { h, s: sat, l } = rgbToHsl(rgb);
    const neutral = sat < 0.1 ? 1 : 0;
    return { neutral, bin: neutral ? 0 : Math.floor(h / HUE_BIN), light: l };
  };
  return [...swatches].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka.neutral !== kb.neutral) return ka.neutral - kb.neutral;
    if (ka.bin !== kb.bin) return ka.bin - kb.bin;
    return kb.light - ka.light; // light → dark within a family
  });
}

// Preview swatches for the bubble picker, with a leading "auto" swatch that
// previews the live theme gradient so it reads as "follow my theme", and a
// trailing "custom" swatch that opens the color picker. Everything between is
// sorted into color families (see sortPalette).
export function bubbleSwatches(scheme: ColorScheme): readonly Swatch[] {
  const auto: Swatch = {
    id: AUTO_ID,
    kind: "gradient",
    colors: gradients[scheme].primary.colors,
  };
  const rest: Swatch[] = BUBBLE_PRESETS.map((p) =>
    p.kind === "gradient"
      ? { id: p.id, kind: "gradient", colors: p.colors }
      : { id: p.id, kind: "solid", colors: [p.color] as const },
  );
  return [auto, ...sortPalette(rest), { id: CUSTOM_SWATCH_ID, kind: "custom" }];
}

export function backgroundSwatches(theme: Theme): readonly Swatch[] {
  const auto: Swatch = {
    id: AUTO_ID,
    kind: "solid",
    colors: [theme["--color-background"]] as const,
  };
  const rest: Swatch[] = BACKGROUND_PRESETS.map((p) =>
    p.kind === "gradient"
      ? { id: p.id, kind: "gradient", colors: p.colors }
      : { id: p.id, kind: "solid", colors: [p.color] as const },
  );
  return [auto, ...sortPalette(rest), { id: CUSTOM_SWATCH_ID, kind: "custom" }];
}
