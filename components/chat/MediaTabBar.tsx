import { AppPressable } from "@/components/AppPressable";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import type { MediaTab } from "@/components/chat/pickerVisibility";
import { StyleSheet, View } from "react-native";

// The segmented tab header inside the unified media drawer. Switches between the
// GIFs, memes, and stickers strips. The active segment takes a primary-subtle
// wash + primary content; inactive segments stay quiet (card surface).
//
// Deliberately SOLID, not GlassSurface: this lives inside CollapsiblePicker,
// whose exit fades the subtree through opacity 0 — and a glass view that ever
// hits opacity 0 blanks permanently (expo-glass-effect bug, see GlassSurface).
// The composer chips can use glass because they sit in the always-mounted row;
// anything inside the faded drawer must not. Pure presentational.

const TABS: MediaTab[] = ["gifs", "memes", "stickers"];

export function MediaTabBar({
  tab,
  onChange,
  labels,
}: {
  tab: MediaTab;
  onChange: (tab: MediaTab) => void;
  labels: Record<MediaTab, string>;
}) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        gap: 6,
        marginBottom: 10,
      }}
    >
      {TABS.map((value) => {
        const active = value === tab;
        return (
          <AppPressable
            key={value}
            onPress={active ? undefined : () => onChange(value)}
            haptic
            hitSlop={4}
            pressScale={0.04}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={labels[value]}
            containerStyle={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}
            style={{
              height: 32,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 10,
              borderRadius: 16,
            }}
          >
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFillObject,
                {
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: active
                    ? theme["--color-primary-muted"]
                    : theme["--color-border"],
                  backgroundColor: active
                    ? theme["--color-primary-subtle"]
                    : theme["--color-card"],
                },
              ]}
            />
            <Typography
              variant="body-sm"
              weight="semibold"
              numberOfLines={1}
              style={{
                color: active
                  ? theme["--color-primary"]
                  : theme["--color-foreground-secondary"],
              }}
            >
              {labels[value]}
            </Typography>
          </AppPressable>
        );
      })}
    </View>
  );
}
