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
  // Gradients (vertical, subtle — they sit behind the whole thread). Six light
  // and two dark, ordered after the leading "Auto" swatch.
  { id: "dawn", kind: "gradient", colors: ["#FFF7ED", "#EEF2FF"], tone: "light" },
  { id: "cotton", kind: "gradient", colors: ["#FDF2F8", "#E0F2FE"], tone: "light" },
  { id: "aurora", kind: "gradient", colors: ["#ECFDF5", "#EEF2FF"], tone: "light" },
  { id: "lilac", kind: "gradient", colors: ["#F5F3FF", "#FCE7F3"], tone: "light" },
  { id: "sunset", kind: "gradient", colors: ["#FFEDD5", "#FFE4E6"], tone: "light" },
  { id: "ocean", kind: "gradient", colors: ["#E0F2FE", "#CCFBF1"], tone: "light" },
  { id: "dusk", kind: "gradient", colors: ["#312E81", "#111827"], tone: "dark" },
  { id: "midnight", kind: "gradient", colors: ["#0F172A", "#312E81"], tone: "dark" },
  // Pastels — gentle full-surface tints (all light).
  { id: "lavender", kind: "solid", color: "#F5F3FF", tone: "light" },
  { id: "sky", kind: "solid", color: "#EFF6FF", tone: "light" },
  { id: "blush", kind: "solid", color: "#FDF2F8", tone: "light" },
  { id: "mint", kind: "solid", color: "#ECFDF5", tone: "light" },
  { id: "sage", kind: "solid", color: "#F0FDF4", tone: "light" },
  { id: "peach", kind: "solid", color: "#FFF7ED", tone: "light" },
  { id: "butter", kind: "solid", color: "#FEFCE8", tone: "light" },
  { id: "stone", kind: "solid", color: "#F8FAFC", tone: "light" },
  // Basics — muted UI colors, soft enough to read as full backgrounds.
  { id: "violet", kind: "solid", color: "#EDE9FE", tone: "light" },
  { id: "blue", kind: "solid", color: "#DBEAFE", tone: "light" },
  { id: "pink", kind: "solid", color: "#FCE7F3", tone: "light" },
  { id: "teal", kind: "solid", color: "#CCFBF1", tone: "light" },
  { id: "green", kind: "solid", color: "#DCFCE7", tone: "light" },
  { id: "orange", kind: "solid", color: "#FFEDD5", tone: "light" },
  { id: "red", kind: "solid", color: "#FFE4E6", tone: "light" },
  { id: "graphite", kind: "solid", color: "#111827", tone: "dark" },
];

// Valid ids (including "auto") for storage validation.
export const BUBBLE_STYLE_IDS: readonly string[] = [
  AUTO_ID,
  ...BUBBLE_PRESETS.map((p) => p.id),
];
export const BACKGROUND_IDS: readonly string[] = [
  AUTO_ID,
  ...BACKGROUND_PRESETS.map((p) => p.id),
];

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

// Relative luminance of a #rrggbb color. Used to decide whether overlays on a
// custom bubble should be black-based (light fill) or white-based (dark fill).
function isDarkText(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.5;
}

function overlaysFor(textColor: string): {
  codeBackgroundColor: string;
  borderColor: string;
} {
  // Dark text means the bubble fill is light → overlay with black; otherwise
  // (white text on a colored/dark fill) overlay with white, matching the stock
  // gradient bubble's existing rgba(255,255,255,…) treatment.
  const base = isDarkText(textColor) ? "0,0,0" : "255,255,255";
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

export const BACKGROUND_SURFACES: Readonly<Record<string, ChatSurface>> = {
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

// The surface a given background id maps its chat chrome to, or null for "auto"
// / unknown ids (keep the stock theme card that tracks light/dark).
export function resolveBackgroundSurface(id: string): ChatSurface | null {
  return BACKGROUND_SURFACES[id] ?? null;
}

// ---- Swatch helpers (for the settings picker) ----

export type Swatch = {
  id: string;
  kind: "gradient" | "solid";
  colors: GradientStops | readonly [string];
};

// Preview swatches for the bubble picker, with a leading "auto" swatch that
// previews the live theme gradient so it reads as "follow my theme".
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
  return [auto, ...rest];
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
  return [auto, ...rest];
}
