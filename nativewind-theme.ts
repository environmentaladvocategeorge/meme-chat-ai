// Meme Chat AI theme
//
// Direction: playful, glossy, meme-native, but still clean enough for chat UI.
// Inspired by the app icon: electric blue, purple, hot pink, soft white mascot,
// yellow spark accents, and darker "internet night mode" surfaces.
//
// Two exports:
//   - `themes`     — solid colors only, consumed by NativeWind via VariableContextProvider.
//   - `gradients`  — typed gradient stops + direction, consumed by `expo-linear-gradient`.
//                    Light + dark variants so brand gradients stay legible across modes.

export const themes = {
  light: {
    "--color-background": "#FBFAFF",
    "--color-background-secondary": "#FFFFFF",
    "--color-background-muted": "#F3F0FF",

    "--color-foreground": "#17131F",
    "--color-foreground-secondary": "#5F586F",
    "--color-foreground-muted": "#928BA3",

    "--color-card": "#FFFFFF",
    "--color-card-foreground": "#17131F",
    "--color-card-muted": "#F5F2FF",
    "--color-card-pressed": "#ECE6FF",

    "--color-border": "#E7DFFF",
    "--color-border-strong": "#CFC2F4",
    "--color-input": "#FFFFFF",
    "--color-ring": "#7C3AED",

    "--color-primary": "#7C3AED",
    "--color-primary-foreground": "#FFFFFF",
    "--color-primary-muted": "#E9DDFF",
    "--color-primary-subtle": "#F4EEFF",

    "--color-secondary": "#FF4FB8",
    "--color-secondary-foreground": "#FFFFFF",

    "--color-tertiary": "#EAF2FF",
    "--color-tertiary-foreground": "#2454D6",

    "--color-success": "#21C48D",
    "--color-success-muted": "#DFF9EF",
    "--color-warning": "#FFCA3A",
    "--color-warning-muted": "#FFF4CC",
    // Pulled toward true red so it visually separates from secondary pink.
    // Original #FF4D6D sat too close to --color-secondary in hue and would
    // make destructive cues read as just "another brand accent."
    "--color-error": "#E63757",
    "--color-error-muted": "#FFE3EA",
    "--color-info": "#22C7F2",
    "--color-info-muted": "#DDF7FF",

    "--color-tab": "#F1ECFF",
    "--color-tab-active": "#FFFFFF",
    "--color-progress-track": "#E7DFFF",
    "--color-overlay": "rgba(23, 19, 31, 0.48)",
  },

  dark: {
    "--color-background": "#0B0714",
    "--color-background-secondary": "#12101D",
    "--color-background-muted": "#1B1730",

    "--color-foreground": "#FFFDF7",
    "--color-foreground-secondary": "#D8D2E8",
    "--color-foreground-muted": "#9E96B7",

    "--color-card": "#171327",
    "--color-card-foreground": "#FFFDF7",
    "--color-card-muted": "#211B38",
    "--color-card-pressed": "#2B2347",

    "--color-border": "#2F2750",
    "--color-border-strong": "#4A3A78",
    "--color-input": "#1D1830",
    "--color-ring": "#B084FF",

    "--color-primary": "#A76BFF",
    "--color-primary-foreground": "#FFFFFF",
    "--color-primary-muted": "#3B2568",
    "--color-primary-subtle": "#24183F",

    "--color-secondary": "#FF5DC8",
    "--color-secondary-foreground": "#FFFFFF",

    "--color-tertiary": "#142C65",
    "--color-tertiary-foreground": "#AFC8FF",

    "--color-success": "#35E6A6",
    "--color-success-muted": "#123827",
    "--color-warning": "#FFD166",
    "--color-warning-muted": "#3A2B12",
    "--color-error": "#FF5872",
    "--color-error-muted": "#3B1821",
    "--color-info": "#43D9FF",
    "--color-info-muted": "#102F3D",

    "--color-tab": "#211B38",
    "--color-tab-active": "#171327",
    "--color-progress-track": "#30284D",
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
// Each name has both a light and dark variant. The dark variant is generally
// the same brand vector recomputed against a darker base — so `brand` reads
// as the same "diagonal sweep" in either mode rather than washing out.
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
      colors: ["#2454FF", "#7C3AED", "#FF4FB8"] as const,
      locations: [0, 0.48, 1] as const,
      ...DIAGONAL_135,
    },
    // Two-stop primary used for buttons, badges, smaller branded surfaces.
    primary: {
      colors: ["#7C3AED", "#FF4FB8"] as const,
      ...DIAGONAL_135,
    },
    // Soft bubble used for chat bubbles + cards that want a subtle lift off the background.
    bubble: {
      colors: ["#FFFFFF", "#F4EEFF"] as const,
      ...DIAGONAL_135,
    },
    // Warm accent for streak badges, energy moments, "AI is thinking" highlights.
    accent: {
      colors: ["#FFCA3A", "#FF7A59"] as const,
      ...DIAGONAL_135,
    },
  },
  dark: {
    brand: {
      colors: ["#184DFF", "#7C3AED", "#FF3FB4"] as const,
      locations: [0, 0.46, 1] as const,
      ...DIAGONAL_135,
    },
    primary: {
      colors: ["#7C3AED", "#FF4FB8"] as const,
      ...DIAGONAL_135,
    },
    bubble: {
      colors: ["#1D1830", "#2B2146"] as const,
      ...DIAGONAL_135,
    },
    accent: {
      colors: ["#FFD166", "#FF7A59"] as const,
      ...DIAGONAL_135,
    },
  },
} as const satisfies Record<"light" | "dark", Record<string, GradientStops>>;

// CSS representations of the same gradients above. Not consumed by React
// Native (View doesn't parse CSS gradient syntax) — kept for the marketing
// website + any future web export so the brand vector stays identical
// across native and web surfaces.
export const cssGradients = {
  brand: "linear-gradient(135deg, #2454FF 0%, #7C3AED 48%, #FF4FB8 100%)",
  primary: "linear-gradient(135deg, #7C3AED 0%, #FF4FB8 100%)",
  bubble: "linear-gradient(135deg, #FFFFFF 0%, #F4EEFF 100%)",
  accent: "linear-gradient(135deg, #FFCA3A 0%, #FF7A59 100%)",
} as const;
