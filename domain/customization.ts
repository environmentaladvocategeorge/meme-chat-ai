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

import { gradients, themes } from "@/nativewind-theme";

export type ColorScheme = "light" | "dark";
type Theme = (typeof themes)[ColorScheme];

const AUTO_ID = "auto" as const;

type GradientStops = readonly [string, string, ...string[]];

// ---- Message bubble styles (applied to the user's own bubbles) ----

type BubblePreset =
  | { id: string; kind: "gradient"; colors: GradientStops; textColor: string }
  | { id: string; kind: "solid"; color: string; textColor: string };

const WHITE = "#FFFFFF";
const INK = "#17131F";

// Order here is the order shown in the picker (after the leading "Auto" swatch).
// Gradients lead and outnumber the solids — they're the headline of the feature.
export const BUBBLE_PRESETS: readonly BubblePreset[] = [
  // Gradients — chosen so white text stays legible across the whole sweep.
  { id: "violet", kind: "gradient", colors: ["#7C3AED", "#FF4FB8"], textColor: WHITE },
  { id: "ocean", kind: "gradient", colors: ["#2454FF", "#22C7F2"], textColor: WHITE },
  { id: "sunset", kind: "gradient", colors: ["#FF7A59", "#FF4FB8"], textColor: WHITE },
  { id: "aurora", kind: "gradient", colors: ["#7C3AED", "#22C7F2"], textColor: WHITE },
  { id: "ember", kind: "gradient", colors: ["#E63757", "#FF7A59"], textColor: WHITE },
  { id: "forest", kind: "gradient", colors: ["#0E8F63", "#21C48D"], textColor: WHITE },
  { id: "midnight", kind: "gradient", colors: ["#3B2568", "#7C3AED"], textColor: WHITE },
  { id: "candy", kind: "gradient", colors: ["#FF4FB8", "#A76BFF"], textColor: WHITE },
  { id: "twilight", kind: "gradient", colors: ["#2454FF", "#7C3AED"], textColor: WHITE },
  { id: "rose", kind: "gradient", colors: ["#E63757", "#FF4FB8"], textColor: WHITE },
  { id: "deepsea", kind: "gradient", colors: ["#0E7490", "#2454FF"], textColor: WHITE },
  { id: "mulberry", kind: "gradient", colors: ["#6D28D9", "#DB2777"], textColor: WHITE },
  { id: "mint", kind: "gradient", colors: ["#0E8F8F", "#21C48D"], textColor: WHITE },
  // Clean, popular gradients — tasteful rather than loud.
  { id: "mauve", kind: "gradient", colors: ["#667EEA", "#764BA2"], textColor: WHITE }, // "Purple Love"
  { id: "royal", kind: "gradient", colors: ["#4B6CB7", "#182848"], textColor: WHITE }, // "Royal Blue"
  { id: "indigo", kind: "gradient", colors: ["#4F46E5", "#7C3AED"], textColor: WHITE },
  { id: "skyline", kind: "gradient", colors: ["#0EA5E9", "#2563EB"], textColor: WHITE },
  { id: "coral", kind: "gradient", colors: ["#FF5E62", "#FF9966"], textColor: WHITE },
  { id: "slate", kind: "gradient", colors: ["#334155", "#1E293B"], textColor: WHITE }, // clean neutral
  // Solids.
  { id: "grape", kind: "solid", color: "#7C3AED", textColor: WHITE },
  { id: "blueberry", kind: "solid", color: "#2454FF", textColor: WHITE },
  { id: "bubblegum", kind: "solid", color: "#FF4FB8", textColor: WHITE },
  { id: "teal", kind: "solid", color: "#0E8F8F", textColor: WHITE },
  { id: "graphite", kind: "solid", color: "#2B2347", textColor: WHITE },
  { id: "ink", kind: "solid", color: INK, textColor: WHITE },
  { id: "cloud", kind: "solid", color: "#EFEAFF", textColor: INK },
];

// ---- Chat backgrounds ----

// `tone` declares whether this is a light or dark surface. The chat view adopts
// that tone for ALL of its other elements (agent bubbles, header, composer,
// text) so nothing fights the background — see useChatAppearance.
type BackgroundPreset =
  | { id: string; kind: "solid"; color: string; tone: ColorScheme }
  | { id: string; kind: "gradient"; colors: GradientStops; tone: ColorScheme };

export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = [
  // Gradients (vertical, subtle — they sit behind the whole thread). Gradients
  // lead and outnumber the solids.
  { id: "dawn", kind: "gradient", colors: ["#FFF1E8", "#F4EEFF"], tone: "light" },
  { id: "cotton", kind: "gradient", colors: ["#FDF2FF", "#EAF2FF"], tone: "light" },
  { id: "sunrise", kind: "gradient", colors: ["#FFF1E8", "#FFE4F0"], tone: "light" },
  { id: "seafoam", kind: "gradient", colors: ["#ECFBF4", "#EAF2FF"], tone: "light" },
  // Brighter, fun light gradients.
  { id: "candyfloss", kind: "gradient", colors: ["#FFD3E0", "#CFE0FF"], tone: "light" },
  { id: "citrus", kind: "gradient", colors: ["#FFF1C9", "#FFD9E8"], tone: "light" },
  { id: "aqua", kind: "gradient", colors: ["#CFF6EC", "#D7E6FF"], tone: "light" },
  { id: "lilac", kind: "gradient", colors: ["#ECDBFF", "#FFDDF0"], tone: "light" },
  // Dark gradients.
  { id: "dusk", kind: "gradient", colors: ["#241B3F", "#0B0714"], tone: "dark" },
  { id: "nebula", kind: "gradient", colors: ["#142C65", "#0B0714"], tone: "dark" },
  { id: "abyss", kind: "gradient", colors: ["#0F2C2C", "#0B0714"], tone: "dark" },
  { id: "berry", kind: "gradient", colors: ["#2D1B3D", "#0B0714"], tone: "dark" },
  // Richer, fun dark gradients.
  { id: "cosmos", kind: "gradient", colors: ["#2B0B4E", "#0B0714"], tone: "dark" },
  { id: "royalnight", kind: "gradient", colors: ["#0B1F4D", "#0B0714"], tone: "dark" },
  { id: "emerald", kind: "gradient", colors: ["#063D2E", "#0B0714"], tone: "dark" },
  { id: "crimson", kind: "gradient", colors: ["#3A0A1B", "#0B0714"], tone: "dark" },
  // Solids.
  { id: "snow", kind: "solid", color: "#FFFFFF", tone: "light" },
  { id: "lavender", kind: "solid", color: "#F3F0FF", tone: "light" },
  { id: "mint", kind: "solid", color: "#ECFBF4", tone: "light" },
  { id: "sky", kind: "solid", color: "#EAF2FF", tone: "light" },
  { id: "plum", kind: "solid", color: "#1B1730", tone: "dark" },
  { id: "midnight", kind: "solid", color: "#0B0714", tone: "dark" },
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
