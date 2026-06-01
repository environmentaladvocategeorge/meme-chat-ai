// The app's reusable dropdown / select control. There was no dropdown primitive
// before this, so it's built to the same discipline as the rest of our touch
// surfaces: the trigger and every option route through AppPressable (static hit
// target + inner press feedback), and it's safe to use both inside a bottom
// sheet and out.
//
// The menu is rendered in a top-level RN <Modal> and anchored to the measured
// trigger frame, opening downward when there's room and flipping upward when
// there isn't — so it never gets clipped by a sheet or the screen edge. Modal
// content lives outside the app's GestureHandlerRootView, so we wrap it in its
// own root; that lets the AppPressable options work whether the surrounding
// tree resolved the touch core to RN's Pressable or gesture-handler's.

import { AppPressable } from "@/components/AppPressable";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { CaretDown, Check } from "phosphor-react-native";
import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  // Optional leading element (e.g. a direction arrow), shown in the menu row
  // and mirrored on the trigger for the selected option.
  icon?: ReactNode;
}

interface DropdownProps<T extends string> {
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  accessibilityLabel: string;
  placeholder?: string;
  // Layout style for the trigger (width / flex / margin). The visual box is
  // owned internally so every dropdown reads the same.
  style?: StyleProp<ViewStyle>;
  // A small, rounded pill trigger (for tucking inline next to other controls)
  // instead of the default full-size field.
  compact?: boolean;
}

type Anchor = { x: number; y: number; width: number; height: number };

const MENU_GAP = 6;
const ROW_HEIGHT = 44;
const MENU_MAX_HEIGHT = ROW_HEIGHT * 5.5;

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
  placeholder,
  style,
  compact = false,
}: DropdownProps<T>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const open = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  }, []);

  const close = useCallback(() => setAnchor(null), []);

  const handleSelect = useCallback(
    (next: T) => {
      onChange(next);
      setAnchor(null);
    },
    [onChange],
  );

  // Flip the menu above the trigger when it would overflow the bottom inset.
  const screenHeight = Dimensions.get("window").height;
  const estimatedHeight = Math.min(
    options.length * ROW_HEIGHT + 8,
    MENU_MAX_HEIGHT,
  );
  const openUpward =
    !!anchor &&
    anchor.y + anchor.height + MENU_GAP + estimatedHeight >
      screenHeight - insets.bottom - 8;

  return (
    <View ref={triggerRef} collapsable={false} style={style}>
      <AppPressable
        onPress={open}
        feedback="opacity"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded: !!anchor }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: compact ? 6 : 8,
          height: compact ? 34 : ROW_HEIGHT,
          paddingHorizontal: compact ? 12 : 14,
          borderRadius: compact ? 999 : 12,
          backgroundColor: theme["--color-card"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      >
        {selected?.icon}
        <Typography
          variant={compact ? "caption" : "body-sm"}
          weight="semibold"
          numberOfLines={1}
          style={{
            flex: compact ? undefined : 1,
            color: selected
              ? theme["--color-foreground"]
              : theme["--color-foreground-secondary"],
          }}
        >
          {selected?.label ?? placeholder ?? ""}
        </Typography>
        <CaretDown
          size={compact ? 13 : 16}
          weight="bold"
          color={theme["--color-foreground-secondary"]}
        />
      </AppPressable>

      <Modal
        visible={!!anchor}
        transparent
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Pressable
            onPress={close}
            accessibilityLabel={accessibilityLabel}
            style={{ flex: 1 }}
          >
            {anchor ? (
              <View
                // Stop the press from bubbling to the backdrop so taps inside
                // the menu don't dismiss it.
                onStartShouldSetResponder={() => true}
                style={{
                  position: "absolute",
                  left: anchor.x,
                  width: anchor.width,
                  top: openUpward
                    ? undefined
                    : anchor.y + anchor.height + MENU_GAP,
                  bottom: openUpward
                    ? screenHeight - anchor.y + MENU_GAP
                    : undefined,
                  maxHeight: MENU_MAX_HEIGHT,
                  borderRadius: 14,
                  backgroundColor: theme["--color-background-secondary"],
                  borderWidth: 1,
                  borderColor: theme["--color-border"],
                  overflow: "hidden",
                  // A soft lift so the menu reads as floating above the sheet.
                  shadowColor: "#000",
                  shadowOpacity: 0.3,
                  shadowRadius: 16,
                  shadowOffset: { width: 0, height: 8 },
                  elevation: 12,
                }}
              >
                <ScrollView
                  bounces={false}
                  showsVerticalScrollIndicator={false}
                >
                  {options.map((option) => {
                    const isSelected = option.value === value;
                    return (
                      <AppPressable
                        key={option.value}
                        onPress={() => handleSelect(option.value)}
                        feedback="opacity"
                        accessibilityLabel={option.label}
                        accessibilityState={{ selected: isSelected }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          height: ROW_HEIGHT,
                          paddingHorizontal: 14,
                          backgroundColor: isSelected
                            ? theme["--color-primary-subtle"]
                            : "transparent",
                        }}
                      >
                        {option.icon}
                        <Typography
                          variant="body-sm"
                          weight={isSelected ? "bold" : "semibold"}
                          numberOfLines={1}
                          style={{
                            flex: 1,
                            color: theme["--color-foreground"],
                          }}
                        >
                          {option.label}
                        </Typography>
                        {isSelected ? (
                          <Check
                            size={16}
                            weight="bold"
                            color={theme["--color-primary"]}
                          />
                        ) : null}
                      </AppPressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
          </Pressable>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}
