import {
  resolveBackground,
  resolveBubble,
  type ResolvedBackground,
  type ResolvedBubble,
} from "@/domain/customization";
import { type ColorScheme } from "@/hooks/useTheme";
import { themes } from "@/nativewind-theme";
import { useEffectivePlan } from "@/store/entitlement";
import { useSettingsStore } from "@/store/settings";
import { useColorScheme } from "nativewind";
import { useMemo } from "react";

type Theme = (typeof themes)[ColorScheme];

export type ChatAppearance = {
  bubble: ResolvedBubble;
  background: ResolvedBackground;
  // The tone the whole chat view should adopt (so agent bubbles, header,
  // composer, and text cohere with the background). null => follow the app's
  // global light/dark scheme. Feed this to <ChatToneContext.Provider>.
  tone: ColorScheme | null;
  // Theme resolved against `tone` — use for the chat screen's own inline styles.
  chatTheme: Theme;
  // Whether the user is allowed to customize (drives the settings UI lock).
  canCustomize: boolean;
};

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
    const chatTheme = themes[effectiveScheme];

    return {
      bubble: resolveBubble(bubbleId, effectiveScheme, chatTheme),
      background: resolvedBackground,
      tone: resolvedBackground.tone,
      chatTheme,
      canCustomize,
    };
  }, [canCustomize, bubbleStyle, background, scheme, globalTheme]);
}
