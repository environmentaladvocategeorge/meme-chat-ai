// AppHeader
//
// The top "card" region that sits at the top of every screen inside the
// (app) group. Renders a slightly elevated card surface with rounded bottom
// corners, and a row with the menu button (or a back arrow) on the left, the
// centered title, and an optional action on the right.

import { IconButton } from "@/components/IconButton";
import { MENU_BUTTON_SIZE, MenuButton } from "@/components/MenuButton";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { ArrowLeft } from "phosphor-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface AppHeaderProps {
  title: string;
  // When set, swaps the menu button on the left for a back arrow. Used on
  // detail screens (e.g. /plan) where the user needs to return to the
  // origin page rather than open the global menu.
  onBack?: () => void;
  backAccessibilityLabel?: string;
  // Optional element rendered in the right-hand slot (kept the same width as
  // the menu button so the title stays geometrically centered). Used by the
  // chat screen for its "new conversation" action.
  right?: ReactNode;
}

export function AppHeader({
  title,
  onBack,
  backAccessibilityLabel,
  right,
}: AppHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        // A small clearance below the safe-area inset for optical balance. We
        // previously padded +12 on the theory that taps near the inset were
        // being swallowed by the OS status-bar strip — that turned out not to
        // be the cause, so this is trimmed back ~8px to sit the header (and its
        // buttons) higher.
        paddingTop: insets.top + 4,
        paddingBottom: 16,
        paddingHorizontal: 16,
        backgroundColor: theme["--color-card"],
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
        shadowColor: theme["--color-foreground"],
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      {/* Title row: button on the left, title flex-centered in the middle,
          a matching-width slot on the right so the title is geometrically
          centered. Sharing a flex row guarantees vertical alignment. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: MENU_BUTTON_SIZE,
        }}
      >
        {onBack ? (
          <IconButton
            onPress={onBack}
            accessibilityLabel={backAccessibilityLabel ?? "Back"}
            size={MENU_BUTTON_SIZE}
            hitSlop={8}
            surfaceStyle={{ backgroundColor: theme["--color-card-muted"] }}
          >
            <ArrowLeft
              size={20}
              weight="bold"
              color={theme["--color-foreground"]}
            />
          </IconButton>
        ) : (
          <MenuButton />
        )}
        <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 8 }}>
          <Typography
            variant="title-xl"
            style={{ color: theme["--color-foreground"], textAlign: "center" }}
            numberOfLines={1}
          >
            {title}
          </Typography>
        </View>
        <View
          style={{
            width: MENU_BUTTON_SIZE,
            height: MENU_BUTTON_SIZE,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {right}
        </View>
      </View>
    </View>
  );
}
