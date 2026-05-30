import { MemeAvatar } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import Animated, { FadeIn } from "react-native-reanimated";

// Playful loading state for the message area. Lives inside the inverted
// FlatList's ListEmptyComponent, so it carries the same counter-flip as the
// empty state to read right-side up.
export function ChatLoading({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(260)}
      style={{
        transform: [{ scaleY: -1 }],
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        paddingVertical: 28,
      }}
    >
      <MemeAvatar variant="loading" size={88} pulse />
      <Typography
        variant="body"
        style={{
          color: theme["--color-foreground-muted"],
          textAlign: "center",
        }}
      >
        {label}
      </Typography>
    </Animated.View>
  );
}
