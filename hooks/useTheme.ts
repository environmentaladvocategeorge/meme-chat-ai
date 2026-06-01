import { themes, type ThemeTokens } from "@/nativewind-theme";
import { useColorScheme } from "nativewind";
import { createContext, useContext, useMemo } from "react";

export type ColorScheme = "light" | "dark";
type Theme = ThemeTokens;

// When the chat view applies a custom background, every chat element needs to
// cohere with that surface's tone — not the app's global light/dark setting —
// or agent bubbles, the header, composer, and text fight the background (e.g. a
// white background under dark-mode chrome). On top of the tone, a custom
// background also swaps the "assistant surface" family (card/border/foreground/
// muted) for a frosted or tinted surface that reads well on it (see
// BACKGROUND_SURFACES + useChatAppearance). Both are delivered here so every
// useTheme() consumer in the chat subtree adapts with zero changes at the call
// sites.
//
// This context is provided ONLY around the chat screen, and defaults to no
// tone + no overrides everywhere else — so the rest of the app keeps following
// the global color scheme and the stock theme untouched.
export type ChatThemeContextValue = {
  tone: ColorScheme | null;
  // Per-background token overrides merged over the toned theme. null => use the
  // theme as-is (the "auto" default).
  overrides: Partial<Theme> | null;
  // Chat-only primary gradient override. null => use the stock system gradient.
  accentGradient: readonly [string, string, ...string[]] | null;
};

const DEFAULT_CHAT_THEME_CONTEXT: ChatThemeContextValue = {
  tone: null,
  overrides: null,
  accentGradient: null,
};

export const ChatToneContext = createContext<ChatThemeContextValue>(
  DEFAULT_CHAT_THEME_CONTEXT,
);

export function useTheme(): Theme {
  const { tone, overrides } = useContext(ChatToneContext);
  const { colorScheme } = useColorScheme();
  const base = themes[tone ?? colorScheme ?? "light"];
  // Stable identity: outside the chat (no overrides) we return the module-
  // constant theme untouched; only the chat subtree allocates a merged object.
  return useMemo(
    () => (overrides ? { ...base, ...overrides } : base),
    [base, overrides],
  );
}

export function useChatAccentGradient():
  | readonly [string, string, ...string[]]
  | null {
  return useContext(ChatToneContext).accentGradient;
}
