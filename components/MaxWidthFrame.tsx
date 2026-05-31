import { ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";

// On wide screens (iPad, large tablets) constrain the app content to a
// phone-like column and center it. Below the threshold the component is
// a zero-overhead passthrough — no extra View nodes.
//
// Exported so overlays that must visually align with this column (e.g. the
// PlayfulMenu pills) can size themselves to the same width.
export const MAX_CONTENT_WIDTH = 616;
// Only constrain once the screen is wider than the column, so the fixed-width
// column never ends up wider than the screen on borderline devices.
const BREAKPOINT = MAX_CONTENT_WIDTH;

export function MaxWidthFrame({
  children,
  backgroundColor,
}: {
  children: ReactNode;
  backgroundColor?: string;
}) {
  const { width } = useWindowDimensions();

  if (width <= BREAKPOINT) {
    return <>{children}</>;
  }

  return (
    <View style={{ flex: 1, backgroundColor, alignItems: "center" }}>
      <View style={{ flex: 1, width: MAX_CONTENT_WIDTH }}>{children}</View>
    </View>
  );
}
