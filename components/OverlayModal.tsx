// Overlay primitives
//
// The shared shell for the app's full-window overlays — the bits that were easy
// to get subtly wrong and were reimplemented in every popover/dialog:
//
//   - OverlayModal: a transparent, status-bar-translucent RN <Modal> so the
//     overlay (and its dim) cover the WHOLE window, not just a host sheet's
//     bounds. Optionally wraps its content in a GestureHandlerRootView — needed
//     when the overlay lives over a @gorhom bottom sheet, whose AppPressables
//     use the gesture-handler touch core and need a root view inside the Modal's
//     separate window to register.
//
//   - OverlayBackdrop: the dim scrim that closes the overlay on tap. Pass an
//     `animatedStyle` (a reanimated opacity) to fade it; omit it for a static
//     dim. Always non-interactive itself; the tap is on the wrapping pressable.
//
// Callers keep their own panel anchoring, entrance animation, and keyboard
// handling — only the shell + scrim are shared.

import { AppPressable } from "@/components/AppPressable";
import { useTheme } from "@/hooks/useTheme";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

export function OverlayModal({
  visible,
  onRequestClose,
  animationType = "none",
  withGestureRoot = false,
  children,
}: {
  visible: boolean;
  // Android hardware back + (when fade) the dismiss transition. Callers that
  // lock the overlay pass a no-op here while it's running.
  onRequestClose: () => void;
  animationType?: "none" | "fade";
  withGestureRoot?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType={animationType}
      onRequestClose={onRequestClose}
    >
      {withGestureRoot ? (
        <GestureHandlerRootView style={{ flex: 1 }}>
          {children}
        </GestureHandlerRootView>
      ) : (
        children
      )}
    </Modal>
  );
}

export function OverlayBackdrop({
  onPress,
  animatedStyle,
  accessibilityLabel,
}: {
  // Omit (or pass undefined) to make the scrim inert — e.g. while a destructive
  // action is in flight and the overlay must not be dismissed.
  onPress?: () => void;
  // Optional reanimated style (typically opacity) to fade the dim in/out.
  animatedStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      feedback="none"
      hitSlop={0}
      accessibilityLabel={accessibilityLabel ?? t("common.close")}
      containerStyle={StyleSheet.absoluteFillObject}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: theme["--color-overlay"] },
          animatedStyle,
        ]}
      />
    </AppPressable>
  );
}
