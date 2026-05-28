import { useTheme } from "@/hooks/useTheme";
import { TouchableOpacity, View } from "react-native";
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

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: theme["--color-tab"],
        borderRadius: 14,
        padding: 4,
        gap: 4,
      }}
    >
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
              backgroundColor: active
                ? theme["--color-tab-active"]
                : "transparent",
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
