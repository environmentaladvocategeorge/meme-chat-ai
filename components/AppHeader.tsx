// AppHeader
//
// The top "card" region that sits at the top of every screen inside the
// (app) group. Renders a slightly elevated card surface with rounded bottom
// corners, and a row with the menu button (or a back arrow) on the left, the
// centered title, and an optional action on the right.

import { MENU_BUTTON_SIZE, MenuButton } from "@/components/MenuButton";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { ArrowLeft } from "phosphor-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
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
        // The safe-area top inset reserves room for the status bar / Dynamic
        // Island. Keeping the buttons hard against that boundary backfires:
        // their hitSlop (8px) extends the *touch* target back up into the
        // OS-reserved strip, where iOS swallows taps (status-bar scroll-to-top
        // / Island exclusion) — so the top of the button reads as a dead zone.
        // We add enough clearance below the inset that the whole touch target,
        // hitSlop included, sits below the boundary, with matching room below
        // so the button still looks optically centered in the header.
        paddingTop: insets.top + 12,
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
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={backAccessibilityLabel ?? "Back"}
            hitSlop={8}
            style={({ pressed }) => ({
              width: MENU_BUTTON_SIZE,
              height: MENU_BUTTON_SIZE,
              borderRadius: MENU_BUTTON_SIZE / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed
                ? theme["--color-card-pressed"]
                : theme["--color-card-muted"],
            })}
          >
            <ArrowLeft
              size={20}
              weight="bold"
              color={theme["--color-foreground"]}
            />
          </Pressable>
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
