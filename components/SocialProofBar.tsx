// SocialProofBar
//
// A compact strip of social proof for the conversion surfaces (trial offer and
// paywall): a 5-star row, the App Store rating, and one real review quote.
//
// The quotes are actual App Store reviews, left verbatim (original spelling and
// casing) so the voice stays the user's, not ours. Reviewer names are stripped
// on purpose: we're showing the words, not who said them. Don't "fix" the
// grammar or translate these per-locale — invented or polished testimonials
// read as fake and defeat the point.

import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { Star } from "phosphor-react-native";
import { useMemo } from "react";
import { View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

export const APP_STORE_REVIEWS: readonly string[] = [
  "this app funny asf gang can't even lie",
  "Like talking to a Gen Z comedian.",
  "I blinked and 15 minutes had passed.",
  "Great app with reliable zingers and a useful setup.",
  "I think I found my new best friend.",
  "great app, very well designed; highly recommend",
];

interface SocialProofBarProps {
  /** Force a specific quote. Omit to pick one at random per mount. */
  quote?: string;
  /**
   * Rating line beside the stars. Defaults to English because the quotes are
   * English too, and stays deliberately non-numeric: a hardcoded "5.0" becomes
   * inaccurate (and Apple-flaggable under Guideline 2.3) the moment the live
   * rating moves. "Loved on the App Store" is durable and never needs updating.
   */
  ratingLabel?: string;
  /** Tighter vertical padding for dense layouts like the paywall sheet. */
  compact?: boolean;
}

export function SocialProofBar({
  quote,
  ratingLabel = "Loved on the App Store",
  compact = false,
}: SocialProofBarProps) {
  const theme = useTheme();

  // One quote per mount. useMemo keeps it stable across re-renders so it
  // doesn't flicker to a new review every time the parent updates.
  const shown = useMemo(
    () =>
      quote ??
      APP_STORE_REVIEWS[Math.floor(Math.random() * APP_STORE_REVIEWS.length)],
    [quote],
  );

  return (
    <Animated.View
      entering={FadeIn.duration(360)}
      style={{
        width: "100%",
        alignItems: "center",
        gap: 6,
        paddingVertical: compact ? 10 : 14,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor: theme["--color-card-muted"],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 1 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} size={14} weight="fill" color="#FFB300" />
          ))}
        </View>
        <Typography
          variant="caption"
          style={{
            color: theme["--color-foreground-secondary"],
            fontWeight: "700",
          }}
        >
          {ratingLabel}
        </Typography>
      </View>
      <Typography
        variant="body-sm"
        style={{
          color: theme["--color-foreground"],
          textAlign: "center",
          fontStyle: "italic",
        }}
      >
        {`"${shown}"`}
      </Typography>
    </Animated.View>
  );
}
