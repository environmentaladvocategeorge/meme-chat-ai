import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  TouchableOpacity,
  View,
  LayoutChangeEvent,
} from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { Typography } from "./Typography";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
}

const OUTER_PADDING = 4;
const GAP = 4;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const theme = useTheme();

  const [width, setWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;

  const activeIndex = useMemo(
    () =>
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    [options, value],
  );

  const segmentWidth =
    options.length > 0
      ? (width - OUTER_PADDING * 2 - GAP * (options.length - 1)) /
        options.length
      : 0;

  useEffect(() => {
    if (!segmentWidth) return;

    Animated.spring(translateX, {
      toValue: activeIndex * (segmentWidth + GAP),
      useNativeDriver: true,
      stiffness: 260,
      damping: 28,
      mass: 0.9,
    }).start();
  }, [activeIndex, segmentWidth, translateX]);

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  return (
    <View
      onLayout={handleLayout}
      style={{
        position: "relative",
        flexDirection: "row",
        backgroundColor: theme["--color-tab"],
        borderRadius: 14,
        padding: OUTER_PADDING,
        gap: GAP,
        overflow: "hidden",
      }}
    >
      {segmentWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: OUTER_PADDING,
            top: OUTER_PADDING,
            bottom: OUTER_PADDING,
            width: segmentWidth,
            borderRadius: 10,
            backgroundColor: theme["--color-tab-active"],
            transform: [{ translateX }],
          }}
        />
      )}

      {options.map((option) => {
        const active = option.value === value;

        return (
          <TouchableOpacity
            key={option.value}
            onPress={() => onChange(option.value)}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              borderRadius: 10,
              paddingVertical: 8,
              alignItems: "center",
              backgroundColor: "transparent",
              zIndex: 1,
            }}
          >
            <Typography
              variant="label"
              style={{
                color: active
                  ? theme["--color-foreground"]
                  : theme["--color-foreground-secondary"],
              }}
            >
              {option.label}
            </Typography>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
