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

// ---- Gradient direction (linear only) ----
//
// A custom gradient is always linear (the app has no radial render path); the
// only spatial knob is which way it sweeps. We model 8 compass directions and
// map each to expo-linear-gradient start/end points. "down" (top → bottom) is
// the default because every existing render site — message bubble, chat
// background, the previews — paints vertically today, so legacy values and
// presets must keep that look.
export type GradientDirection =
  | "down"
  | "up"
  | "right"
  | "left"
  | "down-right"
  | "down-left"
  | "up-right"
  | "up-left";

export const DEFAULT_GRADIENT_DIRECTION: GradientDirection = "down";

// Order here is the order the picker's Direction dropdown lists them in.
export const GRADIENT_DIRECTIONS: readonly GradientDirection[] = [
  "up",
  "down",
  "left",
  "right",
  "up-right",
  "up-left",
  "down-right",
  "down-left",
];

export type GradientPoint = { x: number; y: number };

const DIRECTION_POINTS: Record<
  GradientDirection,
  { start: GradientPoint; end: GradientPoint }
> = {
  down: { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
  up: { start: { x: 0, y: 1 }, end: { x: 0, y: 0 } },
  right: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
  left: { start: { x: 1, y: 0.5 }, end: { x: 0, y: 0.5 } },
  "down-right": { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  "down-left": { start: { x: 1, y: 0 }, end: { x: 0, y: 1 } },
  "up-right": { start: { x: 0, y: 1 }, end: { x: 1, y: 0 } },
  "up-left": { start: { x: 1, y: 1 }, end: { x: 0, y: 0 } },
};

// start/end points for a direction, used directly as the LinearGradient props.
export function gradientDirectionPoints(direction: GradientDirection): {
  start: GradientPoint;
  end: GradientPoint;
} {
  return DIRECTION_POINTS[direction] ?? DIRECTION_POINTS.down;
}

function directionFields(direction: GradientDirection): {
  gradientStart: GradientPoint;
  gradientEnd: GradientPoint;
} {
  const { start, end } = gradientDirectionPoints(direction);
  return { gradientStart: start, gradientEnd: end };
}

// A parsed custom gradient: 2+ evenly-spaced color stops plus a sweep direction.
export type CustomGradient = {
  colors: GradientStops;
  direction: GradientDirection;
};

// ---- Message bubble styles (applied to the user's own bubbles) ----

type BubblePreset =
  | { id: string; kind: "gradient"; colors: GradientStops; textColor: string }
  | { id: string; kind: "solid"; color: string; textColor: string };

const WHITE = "#FFFFFF";
const INK = "#17131F";

export const CHAT_UI_COLOR_ROLES = [
  "accent",
  "subtle",
  "text",
  "userText",
] as const;

export type ChatUiColorRole = (typeof CHAT_UI_COLOR_ROLES)[number];
export type ChatUiColorOverrides = Partial<Record<ChatUiColorRole, string>>;

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
export function withAlpha(hex: string, alpha: number): string {
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
// A custom pick is stored inline as `custom:#RRGGBB` or
// `custom-gradient:#RRGGBB:#RRGGBB` so it rides through the same string setting
// as the presets (no schema change), while staying easy to detect and validate.
// The resolve functions below special-case it and derive every dependent color
// from it via the contrast helpers above.
const CUSTOM_PREFIX = "custom:";
const CUSTOM_GRADIENT_PREFIX = "custom-gradient:";

export function makeCustomColorId(hex: string): string {
  return `${CUSTOM_PREFIX}${normalizeHex(hex) ?? "#000000"}`;
}

export function parseCustomColor(id: string): string | null {
  if (!id.startsWith(CUSTOM_PREFIX)) return null;
  return normalizeHex(id.slice(CUSTOM_PREFIX.length));
}

// Short codes so the direction rides inline in the id without bloating it. The
// default "down" direction emits NO code, so a 2-stop down gradient serializes
// to exactly the legacy `custom-gradient:#A:#B` — old stored values and the
// simple case stay byte-identical.
const DIRECTION_CODES: Record<GradientDirection, string> = {
  down: "d",
  up: "u",
  right: "r",
  left: "l",
  "down-right": "dr",
  "down-left": "dl",
  "up-right": "ur",
  "up-left": "ul",
};
const CODE_TO_DIRECTION: Record<string, GradientDirection> = Object.fromEntries(
  Object.entries(DIRECTION_CODES).map(([dir, code]) => [code, dir]),
) as Record<string, GradientDirection>;

export function makeCustomGradientId(
  colors: readonly string[],
  direction: GradientDirection = DEFAULT_GRADIENT_DIRECTION,
): string {
  const stops = colors.map((c) => normalizeHex(c) ?? "#000000");
  // Guarantee at least two stops so the value is always a well-formed gradient.
  const safe =
    stops.length >= 2 ? stops : [stops[0] ?? "#000000", stops[0] ?? "#000000"];
  const code =
    direction === DEFAULT_GRADIENT_DIRECTION
      ? ""
      : `${DIRECTION_CODES[direction]}:`;
  return `${CUSTOM_GRADIENT_PREFIX}${code}${safe.join(":")}`;
}

export function parseCustomGradient(id: string): CustomGradient | null {
  if (!id.startsWith(CUSTOM_GRADIENT_PREFIX)) return null;
  const segments = id
    .slice(CUSTOM_GRADIENT_PREFIX.length)
    .split(":")
    .filter(Boolean);
  // A leading non-hex segment is the direction code (hex stops always start with
  // "#"); its absence means the default "down" sweep.
  let direction = DEFAULT_GRADIENT_DIRECTION;
  if (segments.length > 0 && CODE_TO_DIRECTION[segments[0]]) {
    direction = CODE_TO_DIRECTION[segments[0]];
    segments.shift();
  }
  if (segments.length < 2) return null;
  const colors: string[] = [];
  for (const seg of segments) {
    const hex = normalizeHex(seg);
    if (!hex) return null;
    colors.push(hex);
  }
  return { colors: colors as unknown as GradientStops, direction };
}

// Order here is the order shown in the picker (after the leading "Auto" swatch):
// rich gradients first, then a short pastel row, then saturated solids. The
// gradient text color is picked per pair so bright neon sweeps use ink instead
// of forcing white text onto low-contrast stops.
export const BUBBLE_PRESETS: readonly BubblePreset[] = [
  // Gradients.
  { id: "electricNight", kind: "gradient", colors: ["#5B21B6", "#BE185D"], textColor: WHITE },
  { id: "cyberMint", kind: "gradient", colors: ["#00B4D8", "#00F5A0"], textColor: INK },
  { id: "sunsetPunch", kind: "gradient", colors: ["#FF416C", "#FF8A00"], textColor: INK },
  { id: "aquaLime", kind: "gradient", colors: ["#00D9F5", "#B6FF00"], textColor: INK },
  { id: "royalPulse", kind: "gradient", colors: ["#3B5BDB", "#7C3AED"], textColor: WHITE },
  { id: "berryVibe", kind: "gradient", colors: ["#CC2B5E", "#753A88"], textColor: WHITE },
  { id: "lemonPop", kind: "gradient", colors: ["#F7971E", "#FFD200"], textColor: INK },
  { id: "bubblegumPeach", kind: "gradient", colors: ["#FFAFBD", "#FFC3A0"], textColor: INK },
  { id: "indigoWave", kind: "gradient", colors: ["#3730A3", "#2563EB"], textColor: WHITE },
  { id: "fuchsiaFlame", kind: "gradient", colors: ["#C026D3", "#E11D48"], textColor: WHITE },
  // Pastels.
  { id: "lavender", kind: "solid", color: "#EDE9FE", textColor: INK },
  { id: "sky", kind: "solid", color: "#DBEAFE", textColor: INK },
  { id: "blush", kind: "solid", color: "#FCE7F3", textColor: INK },
  { id: "mint", kind: "solid", color: "#CCFBF1", textColor: INK },
  { id: "sage", kind: "solid", color: "#DCFCE7", textColor: INK },
  { id: "peach", kind: "solid", color: "#FFEDD5", textColor: INK },
  { id: "rose", kind: "solid", color: "#FFE4E6", textColor: INK },
  { id: "sand", kind: "solid", color: "#FEF3C7", textColor: INK },
  // Basics.
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
  // Rich messaging gradients.
  { id: "electricViolet", kind: "gradient", colors: ["#7F00FF", "#E100FF"], tone: "dark" },
  { id: "cyberBlue", kind: "gradient", colors: ["#007CF0", "#00DFD8"], tone: "light" },
  { id: "sunset", kind: "gradient", colors: ["#FF416C", "#FF4B2B"], tone: "light" },
  { id: "aquaMint", kind: "gradient", colors: ["#00F5A0", "#00D9F5"], tone: "light" },
  { id: "royalBlue", kind: "gradient", colors: ["#4776E6", "#8E54E9"], tone: "dark" },
  { id: "magentaViolet", kind: "gradient", colors: ["#CC2B5E", "#753A88"], tone: "dark" },
  { id: "lemonPunch", kind: "gradient", colors: ["#F7971E", "#FFD200"], tone: "light" },
  { id: "bubblegum", kind: "gradient", colors: ["#FFAFBD", "#FFC3A0"], tone: "light" },
  { id: "indigoBlue", kind: "gradient", colors: ["#4E54C8", "#8F94FB"], tone: "dark" },
  { id: "fuchsiaRush", kind: "gradient", colors: ["#F953C6", "#B91D73"], tone: "dark" },
  { id: "popRocks", kind: "gradient", colors: ["#FB7185", "#A78BFA"], tone: "light" },
  { id: "tropicalSignal", kind: "gradient", colors: ["#22D3EE", "#A3E635"], tone: "light" },
  { id: "deepSpace", kind: "gradient", colors: ["#0F172A", "#3730A3"], tone: "dark" },
  { id: "cherryCola", kind: "gradient", colors: ["#881337", "#431407"], tone: "dark" },
  // Pastels.
  { id: "lavender", kind: "solid", color: "#F5F3FF", tone: "light" },
  { id: "sky", kind: "solid", color: "#EFF6FF", tone: "light" },
  { id: "blush", kind: "solid", color: "#FDF2F8", tone: "light" },
  { id: "mint", kind: "solid", color: "#ECFDF5", tone: "light" },
  { id: "peach", kind: "solid", color: "#FFF7ED", tone: "light" },
  { id: "butter", kind: "solid", color: "#FEFCE8", tone: "light" },
  { id: "periwinkle", kind: "solid", color: "#DCE0FF", tone: "light" },
  { id: "seaglass", kind: "solid", color: "#CFEFE6", tone: "light" },
  // Deep solids.
  { id: "graphite", kind: "solid", color: "#111827", tone: "dark" },
  { id: "plum", kind: "solid", color: "#241733", tone: "dark" },
  { id: "navy", kind: "solid", color: "#0E1A30", tone: "dark" },
  { id: "pine", kind: "solid", color: "#0C2A22", tone: "dark" },
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
  return (
    BUBBLE_STYLE_SET.has(id) ||
    parseCustomColor(id) !== null ||
    parseCustomGradient(id) !== null
  );
}
export function isBackgroundId(id: string): boolean {
  return (
    BACKGROUND_SET.has(id) ||
    parseCustomColor(id) !== null ||
    parseCustomGradient(id) !== null
  );
}

export const DEFAULT_BUBBLE_STYLE = AUTO_ID;
export const DEFAULT_BACKGROUND = AUTO_ID;

// ---- Resolution ----

export type ResolvedBubble = {
  kind: "gradient" | "solid";
  gradientColors: GradientStops | null;
  // LinearGradient start/end for the gradient sweep (null for solids). Derived
  // from the custom direction; presets/auto resolve to the default "down".
  gradientStart: GradientPoint | null;
  gradientEnd: GradientPoint | null;
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
  gradientStart: GradientPoint | null;
  gradientEnd: GradientPoint | null;
  // The tone the rest of the chat should adopt. null => follow the app's
  // global light/dark scheme (the "auto" default).
  tone: ColorScheme | null;
};

export type BubbleAccentTokens = Pick<
  Theme,
  | "--color-primary"
  | "--color-primary-foreground"
  | "--color-primary-muted"
  | "--color-primary-subtle"
  | "--color-ring"
>;

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

export function bubbleOverlaysForTextColor(textColor: string): {
  codeBackgroundColor: string;
  borderColor: string;
} {
  return overlaysFor(textColor);
}

export function readableGradientTextColor(colors: GradientStops): string {
  const whiteMin = Math.min(
    ...colors.map((color) => contrastRatio(color, WHITE)),
  );
  const inkMin = Math.min(...colors.map((color) => contrastRatio(color, INK)));
  return whiteMin >= inkMin ? WHITE : INK;
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
      ...directionFields(DEFAULT_GRADIENT_DIRECTION),
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
      gradientStart: null,
      gradientEnd: null,
      solidColor: custom,
      textColor,
      ...overlaysFor(textColor),
    };
  }

  const customGradient = parseCustomGradient(id);
  if (customGradient) {
    const textColor = readableGradientTextColor(customGradient.colors);
    return {
      kind: "gradient",
      gradientColors: customGradient.colors,
      ...directionFields(customGradient.direction),
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
      ...directionFields(DEFAULT_GRADIENT_DIRECTION),
      solidColor: null,
      textColor: preset.textColor,
      ...overlaysFor(preset.textColor),
    };
  }

  return {
    kind: "solid",
    gradientColors: null,
    gradientStart: null,
    gradientEnd: null,
    solidColor: preset.color,
    textColor: preset.textColor,
    ...overlaysFor(preset.textColor),
  };
}

// Chat-page accent tokens for the user's explicit Accent color. Components like
// thumbs, GIF/meme chips, camera, and selection affordances already read the
// primary family, so overriding this family inside the chat theme makes the
// whole page follow the chosen accent without per-component plumbing.
export function chatUiAccentTokens(
  accent: string,
  textColor = readableTextColor(accent),
): BubbleAccentTokens {
  return {
    "--color-primary": accent,
    "--color-primary-foreground": textColor,
    "--color-primary-muted": withAlpha(accent, 0.22),
    "--color-primary-subtle": withAlpha(accent, 0.12),
    "--color-ring": accent,
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
      gradientStart: null,
      gradientEnd: null,
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
      gradientStart: null,
      gradientEnd: null,
      tone: isDarkColor(custom) ? "dark" : "light",
    };
  }

  const customGradient = parseCustomGradient(id);
  if (customGradient) {
    const { colors } = customGradient;
    const representative = mix(colors[0], colors[colors.length - 1], 0.5);
    return {
      kind: "gradient",
      color: null,
      gradientColors: colors,
      ...directionFields(customGradient.direction),
      tone: isDarkColor(representative) ? "dark" : "light",
    };
  }

  const preset = BACKGROUND_PRESETS.find((p) => p.id === id);
  if (!preset) return resolveBackground(AUTO_ID, theme);

  if (preset.kind === "gradient") {
    return {
      kind: "gradient",
      color: null,
      gradientColors: preset.colors,
      ...directionFields(DEFAULT_GRADIENT_DIRECTION),
      tone: preset.tone,
    };
  }
  return {
    kind: "solid",
    color: preset.color,
    gradientColors: null,
    gradientStart: null,
    gradientEnd: null,
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

function customGradientSurface(colors: GradientStops): ChatSurface {
  const base = mix(colors[0], colors[colors.length - 1], 0.5);
  return tunedSurface(base, isDarkColor(base) ? "dark" : "light");
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
  const customGradient = parseCustomGradient(id);
  if (customGradient) return customGradientSurface(customGradient.colors);
  return BACKGROUND_SURFACES[id] ?? null;
}

// ---- Centralized picker presets ----
//
// The global color picker shows a short, shared row of quick-start presets (a
// preset is just a starting point the user can immediately tweak). These are
// intentionally generic and few — not the full preset library — so the row
// stays minimal. Solid mode shows dots; gradient mode shows pills.
export const PICKER_SOLID_PRESETS: readonly string[] = [
  "#9A5CFF",
  "#FF4FA3",
  "#FF3B30",
  "#FF9500",
  "#FFD60A",
  "#34C759",
  "#32ADE6",
  "#5B6CFF",
];

export const PICKER_GRADIENT_PRESETS: readonly (readonly [string, string])[] = [
  ["#9A5CFF", "#5B6CFF"],
  ["#FF4FA3", "#FF3B30"],
  ["#FF9500", "#FFD60A"],
  ["#34C759", "#A3E635"],
  ["#32ADE6", "#5B6CFF"],
  ["#7F00FF", "#E100FF"],
];

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
