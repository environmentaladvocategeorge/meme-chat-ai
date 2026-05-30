import { themes } from "@/nativewind-theme";
import { useColorScheme } from "nativewind";
import { createContext, useContext } from "react";

export type ColorScheme = "light" | "dark";

// When the chat view applies a custom background, every chat element needs to
// cohere with that surface's tone — not the app's global light/dark setting —
// or agent bubbles, the header, composer, and text fight the background (e.g. a
// white background under dark-mode chrome). Providing a tone here forces every
// useTheme() consumer in the subtree onto that tone, with zero changes at the
// call sites. Defaults to null everywhere outside the chat, so the rest of the
// app keeps following the global color scheme.
export const ChatToneContext = createContext<ColorScheme | null>(null);

export function useTheme() {
  const tone = useContext(ChatToneContext);
  const { colorScheme } = useColorScheme();
  return themes[tone ?? colorScheme ?? "light"];
}
