import {
  bubbleOverlaysForTextColor,
  chatUiAccentTokens,
  readableTextColor,
  resolveBackground,
  resolveBubble,
  withAlpha,
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
function subtleColorOverrides(subtle: string): Partial<Theme> {
  const textColor = readableTextColor(subtle);
  return {
    "--color-card": subtle,
    "--color-card-muted": subtle,
    "--color-input": subtle,
    "--color-background-muted": subtle,
    "--color-foreground": textColor,
    "--color-card-foreground": textColor,
    "--color-border": subtle,
    "--color-foreground-muted": textColor,
  };
}

// The user's "Chat text" color drives every text token in the chat. There's no
// separate placeholder control — placeholders/secondary text are just the text
// color at reduced opacity, so picking a text color shifts them in lockstep.
function textColorOverrides(text: string): Partial<Theme> {
  return {
    "--color-foreground": text,
    "--color-card-foreground": text,
    "--color-foreground-secondary": withAlpha(text, 0.7),
    "--color-foreground-muted": withAlpha(text, 0.45),
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
  const chatUiColors = useSettingsStore((s) => s.chatUiColors);

  return useMemo(() => {
    const bubbleId = canCustomize ? bubbleStyle : "auto";
    const backgroundId = canCustomize ? background : "auto";

    const resolvedBackground = resolveBackground(backgroundId, globalTheme);
    // Background no longer drives the chat chrome. Users can customize surfaces
    // directly, so changing Background only changes the backdrop.
    const baseTheme = themes[scheme];
    const surface: ChatSurface | null = null;
    const resolvedBubble = resolveBubble(bubbleId, scheme, baseTheme);
    const activeUiColors = canCustomize ? chatUiColors : {};
    const bubble = activeUiColors.userText
      ? {
          ...resolvedBubble,
          textColor: activeUiColors.userText,
          ...bubbleOverlaysForTextColor(activeUiColors.userText),
        }
      : resolvedBubble;
    // The accent family (buttons, icons, send/menu glow, selection) follows the
    // user's explicit Accent color ONLY — it is no longer tied to the message
    // bubble or the background. (Before there was a dedicated Accent control the
    // accent borrowed the bubble's color; now that users pick accent directly,
    // that binding is gone.) With no explicit accent we pin the family to the
    // app's global scheme, so neither a bubble gradient nor a tone-flipping
    // background can drag the buttons' color with it.
    const customAccent = activeUiColors.accent
      ? chatUiAccentTokens(activeUiColors.accent)
      : null;
    const accentFromGlobal = customAccent
      ? null
      : {
          "--color-primary": globalTheme["--color-primary"],
          "--color-primary-foreground": globalTheme["--color-primary-foreground"],
          "--color-primary-muted": globalTheme["--color-primary-muted"],
          "--color-primary-subtle": globalTheme["--color-primary-subtle"],
          "--color-ring": globalTheme["--color-ring"],
        };
    const accentGradient = activeUiColors.accent
      ? ([activeUiColors.accent, activeUiColors.accent] as const)
      : null;
    const chatOverrides = {
      ...(accentFromGlobal ?? {}),
      ...(customAccent ?? {}),
      ...(activeUiColors.subtle
        ? subtleColorOverrides(activeUiColors.subtle)
        : {}),
      // Text wins over the subtle surface's auto-contrast text, since it's the
      // explicit choice; placeholders ride along as an opacity of it.
      ...(activeUiColors.text ? textColorOverrides(activeUiColors.text) : {}),
    };
    const themeOverrides = Object.keys(chatOverrides).length
      ? chatOverrides
      : null;
    const chatTheme = themeOverrides
      ? { ...baseTheme, ...themeOverrides }
      : baseTheme;

    return {
      bubble,
      background: resolvedBackground,
      tone: null,
      surface,
      themeContext: {
        tone: null,
        overrides: themeOverrides,
        accentGradient,
      },
      chatTheme,
      canCustomize,
    };
  }, [canCustomize, bubbleStyle, background, chatUiColors, scheme, globalTheme]);
}
