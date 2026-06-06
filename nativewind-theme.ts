// Meme Chat AI theme
//
// Direction: confident, modern, "a real tool" — playful enough for a meme app
// but intentionally NOT the saturated blue→purple→hot-pink neon that reads as
// generic AI. Built on a muted teal as the single brand hue, cool paper/ink
// neutrals, and one warm amber accent for energy moments (teal + amber is a
// deliberate complementary pair).
//
// Two exports:
//   - `themes`     — solid colors only, consumed by NativeWind via VariableContextProvider.
//   - `gradients`  — typed gradient stops + direction, consumed by `expo-linear-gradient`.
//                    Light + dark variants so brand gradients stay legible across modes.

export const themes = {
  light: {
    "--color-background": "#F6F7F8",
    "--color-background-secondary": "#FFFFFF",
    "--color-background-muted": "#ECEEF0",

    "--color-foreground": "#16191C",
    "--color-foreground-secondary": "#4C5359",
    "--color-foreground-muted": "#858C92",

    "--color-card": "#FFFFFF",
    "--color-card-foreground": "#16191C",
    "--color-card-muted": "#F2F3F5",
    "--color-card-pressed": "#E6E8EB",

    "--color-border": "#E0E3E6",
    "--color-border-strong": "#C5CACE",
    "--color-input": "#FFFFFF",
    "--color-ring": "#0F7B85",

    "--color-primary": "#0F7B85",
    "--color-primary-foreground": "#FFFFFF",
    "--color-primary-muted": "#CFE8EA",
    "--color-primary-subtle": "#E8F4F5",

    "--color-secondary": "#38A9AE",
    "--color-secondary-foreground": "#FFFFFF",

    "--color-tertiary": "#E2F2F3",
    "--color-tertiary-foreground": "#0F7B85",

    // Nudged toward a warmer leaf-green so "success" stays distinct from the
    // teal brand hue instead of blurring into it.
    "--color-success": "#2FA15A",
    "--color-success-muted": "#DCF2E5",
    "--color-warning": "#E0A234",
    "--color-warning-muted": "#FBEFD6",
    // Pulled toward true red so it reads as "destructive," not as another
    // brand accent.
    "--color-error": "#DC4B63",
    "--color-error-muted": "#FBE2E7",
    "--color-info": "#2B86C4",
    "--color-info-muted": "#E0F0FA",

    "--color-tab": "#ECEEF0",
    "--color-tab-active": "#FFFFFF",
    "--color-progress-track": "#E0E3E6",
    "--color-overlay": "rgba(22, 25, 28, 0.48)",
  },

  dark: {
    "--color-background": "#0E1113",
    "--color-background-secondary": "#15191C",
    "--color-background-muted": "#1D2226",

    "--color-foreground": "#F1F3F4",
    "--color-foreground-secondary": "#C3C8CC",
    "--color-foreground-muted": "#868D92",

    "--color-card": "#15191C",
    "--color-card-foreground": "#F1F3F4",
    "--color-card-muted": "#1C2125",
    "--color-card-pressed": "#272D32",

    "--color-border": "#2A3034",
    "--color-border-strong": "#3D454B",
    "--color-input": "#161B1E",
    "--color-ring": "#45BFC9",

    "--color-primary": "#34ABB5",
    "--color-primary-foreground": "#FFFFFF",
    "--color-primary-muted": "#123C42",
    "--color-primary-subtle": "#0E2D32",

    "--color-secondary": "#58C2CA",
    "--color-secondary-foreground": "#FFFFFF",

    "--color-tertiary": "#0E3338",
    "--color-tertiary-foreground": "#9FE0E6",

    "--color-success": "#36C982",
    "--color-success-muted": "#0E3327",
    "--color-warning": "#E8B45A",
    "--color-warning-muted": "#382B12",
    "--color-error": "#F0697F",
    "--color-error-muted": "#3A1822",
    "--color-info": "#4FA7E0",
    "--color-info-muted": "#102B3D",

    "--color-tab": "#1C2125",
    "--color-tab-active": "#15191C",
    "--color-progress-track": "#262C30",
    "--color-overlay": "rgba(0, 0, 0, 0.64)",
  },
} as const;

// A theme as a plain map of token → color string. `themes` is `as const` (each
// token is a literal type), which is great for autocomplete but means you can't
// build a theme with runtime-computed colors. This loose shape is what the chat
// view uses once it merges per-background surface overrides over the base theme.
export type ThemeTokens = Record<keyof (typeof themes)["light"], string>;

// Gradients
//
// `expo-linear-gradient` consumes `colors`, `locations?`, `start`, `end`.
// We pre-compute the 135° vector as start={0,0} → end={1,1}, matching the
// CSS `linear-gradient(135deg, ...)` notation the original palette used.
//
// The brand sweep is a restrained single-hue teal (deep → light) rather than a
// multi-hue neon sweep — it reads as one deliberate brand color in either mode.
// `accent` is the one warm pop, kept controlled (amber → soft terracotta) so
// "energy" moments don't tip back into neon.
//
// Usage:
//   import { LinearGradient } from "expo-linear-gradient";
//   import { gradients } from "@/nativewind-theme";
//   import { useColorScheme } from "nativewind";
//
//   const { colorScheme } = useColorScheme();
//   const g = gradients[colorScheme ?? "light"].brand;
//   <LinearGradient
//     colors={g.colors}
//     locations={g.locations}
//     start={g.start}
//     end={g.end}
//   />

export type GradientStops = {
  colors: readonly [string, string, ...string[]];
  locations?: readonly [number, number, ...number[]];
  start: { x: number; y: number };
  end: { x: number; y: number };
};

const DIAGONAL_135 = {
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
} as const;

export const gradients = {
  light: {
    // Three-stop brand sweep used for hero surfaces, splash, primary CTAs at hero scale.
    brand: {
      colors: ["#0B6470", "#0F7B85", "#38A9AE"] as const,
      locations: [0, 0.5, 1] as const,
      ...DIAGONAL_135,
    },
    // Two-stop primary used for buttons, badges, smaller branded surfaces.
    primary: {
      colors: ["#0F7B85", "#38A9AE"] as const,
      ...DIAGONAL_135,
    },
    // Soft bubble used for chat bubbles + cards that want a subtle lift off the background.
    bubble: {
      colors: ["#FFFFFF", "#E8F4F5"] as const,
      ...DIAGONAL_135,
    },
    // Warm accent for streak badges, energy moments, "AI is thinking" highlights.
    accent: {
      colors: ["#F2B23D", "#E8894A"] as const,
      ...DIAGONAL_135,
    },
  },
  dark: {
    brand: {
      colors: ["#0A4E58", "#0F7B85", "#34ABB5"] as const,
      locations: [0, 0.5, 1] as const,
      ...DIAGONAL_135,
    },
    primary: {
      colors: ["#0F7B85", "#38A9AE"] as const,
      ...DIAGONAL_135,
    },
    bubble: {
      colors: ["#122528", "#1B383C"] as const,
      ...DIAGONAL_135,
    },
    accent: {
      colors: ["#E8B45A", "#D9824A"] as const,
      ...DIAGONAL_135,
    },
  },
} as const satisfies Record<"light" | "dark", Record<string, GradientStops>>;

// CSS representations of the same gradients above. Not consumed by React
// Native (View doesn't parse CSS gradient syntax) — kept for the marketing
// website + any future web export so the brand vector stays identical
// across native and web surfaces.
export const cssGradients = {
  brand: "linear-gradient(135deg, #0B6470 0%, #0F7B85 50%, #38A9AE 100%)",
  primary: "linear-gradient(135deg, #0F7B85 0%, #38A9AE 100%)",
  bubble: "linear-gradient(135deg, #FFFFFF 0%, #E8F4F5 100%)",
  accent: "linear-gradient(135deg, #F2B23D 0%, #E8894A 100%)",
} as const;
