import {
  resolveBackground,
  resolveBackgroundSurface,
  resolveBubble,
  type ChatSurface,
  type ResolvedBackground,
  type ResolvedBubble,
} from "@/domain/customization";
import {
  type ChatThemeContextValue,
  type ColorScheme,
} from "@/hooks/useTheme";
import { themes, type ThemeTokens } from "@/nativewind-theme";
import { useEffectivePlan } from "@/store/entitlement";
import { useSettingsStore } from "@/store/settings";
import { useColorScheme } from "nativewind";
import { useMemo } from "react";

type Theme = ThemeTokens;

export type ChatAppearance = {
  bubble: ResolvedBubble;
  background: ResolvedBackground;
  // The tone the whole chat view should adopt (so agent bubbles, header,
  // composer, and text cohere with the background). null => follow the app's
  // global light/dark scheme.
  tone: ColorScheme | null;
  // The per-background assistant surface (agent bubble / chat bar / cards), or
  // null for the "auto" default. Exposed for previews that style chrome by hand.
  surface: ChatSurface | null;
  // Tone + token overrides bundled for <ChatToneContext.Provider> — drives the
  // whole chat subtree's chrome to the chosen surface with no call-site edits.
  themeContext: ChatThemeContextValue;
  // Theme resolved against `tone` AND the surface overrides — use for the chat
  // screen's own inline styles and the live preview.
  chatTheme: Theme;
  // Whether the user is allowed to customize (drives the settings UI lock).
  canCustomize: boolean;
};

// Which theme tokens a background's surface swaps. Kept here (not in the config
// file) because it's the structural map from the 4 surface roles onto the
// concrete tokens the chat chrome reads via useTheme(); the colors themselves
// live in BACKGROUND_SURFACES. Covers the assistant surface family only — the
// chat background and the user's own bubble are resolved separately, so they're
// untouched.
function surfaceOverrides(surface: ChatSurface | null): Partial<Theme> | null {
  if (!surface) return null;
  return {
    "--color-card": surface.surface,
    "--color-card-foreground": surface.surfaceText,
    "--color-foreground": surface.surfaceText,
    "--color-border": surface.surfaceBorder,
    "--color-foreground-muted": surface.surfaceMuted,
  };
}

// Resolves the chat's bubble + background look from local settings, and the
// tone the rest of the chat should follow so a custom background never clashes
// with the surrounding chrome.
//
// Gating: App Customization is a paid feature. Free users always get "auto"
// here regardless of any stored preference, so a downgrade reverts the look
// automatically — we never have to mutate what's saved on disk.
export function useChatAppearance(): ChatAppearance {
  const { colorScheme } = useColorScheme();
  const scheme: ColorScheme = colorScheme ?? "light";
  const globalTheme = themes[scheme];

  // Effective (RC-live ∪ mirror) plan, not display plan: right after an
  // upgrade RevenueCat flips to the new tier immediately while the backend
  // entitlement mirror lags a beat, so gating on the mirror would leave the
  // feature locked until the webhook syncs. This gate is cosmetic, not
  // payment-critical, so taking the higher of the two is safe and correct.
  const plan = useEffectivePlan();
  const canCustomize = plan !== "free";

  const bubbleStyle = useSettingsStore((s) => s.chatBubbleStyle);
  const background = useSettingsStore((s) => s.chatBackground);

  return useMemo(() => {
    const bubbleId = canCustomize ? bubbleStyle : "auto";
    const backgroundId = canCustomize ? background : "auto";

    const resolvedBackground = resolveBackground(backgroundId, globalTheme);
    // A custom background dictates the chat tone; "auto" follows the app.
    const effectiveScheme: ColorScheme = resolvedBackground.tone ?? scheme;
    const baseTheme = themes[effectiveScheme];

    // Swap the assistant-surface tokens for the ones that read well on this
    // background. null for "auto" / free users, so the stock theme is untouched.
    const surface = resolveBackgroundSurface(backgroundId);
    const overrides = surfaceOverrides(surface);
    const chatTheme = overrides ? { ...baseTheme, ...overrides } : baseTheme;

    return {
      bubble: resolveBubble(bubbleId, effectiveScheme, chatTheme),
      background: resolvedBackground,
      tone: resolvedBackground.tone,
      surface,
      themeContext: { tone: resolvedBackground.tone, overrides },
      chatTheme,
      canCustomize,
    };
  }, [canCustomize, bubbleStyle, background, scheme, globalTheme]);
}
