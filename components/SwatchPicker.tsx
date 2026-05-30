import { type Swatch } from "@/domain/customization";
import { useTheme } from "@/hooks/useTheme";
import {
  TouchableOpacity as BottomSheetTouchableOpacity,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import { Check } from "phosphor-react-native";
import { View } from "react-native";

const SIZE = 52;
// Outer swatch incl. its 2px selection ring + 4px breathing room.
const RING = SIZE + 6;
const GAP = 12;
const ROWS = 2;
// The picker is capped to exactly two rows of swatches plus the gap between
// them, then scrolls left↔right instead of growing down the sheet.
const TRACK_HEIGHT = RING * ROWS + GAP;

interface SwatchPickerProps {
  options: readonly Swatch[];
  value: string;
  onChange: (id: string) => void;
  // Accessible label prefix per swatch, e.g. "Message style".
  labelPrefix: string;
}

// A two-row band of selectable color/gradient swatches that scrolls
// horizontally. The selected swatch gets a ring + check overlay. Capping the
// height to two rows keeps each section (message style / background) compact so
// the sheet shows the preview + both pickers without a long vertical scroll —
// the swatches themselves scroll left↔right within the band.
export function SwatchPicker({
  options,
  value,
  onChange,
  labelPrefix,
}: SwatchPickerProps) {
  const theme = useTheme();

  return (
    <BottomSheetScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingVertical: 2 }}
    >
      <View
        style={{
          height: TRACK_HEIGHT,
          flexDirection: "column",
          flexWrap: "wrap",
          alignContent: "flex-start",
          gap: GAP,
        }}
      >
        {options.map((option) => {
          const selected = option.id === value;
          const ringColor = selected
            ? theme["--color-primary"]
            : theme["--color-border"];

          return (
            <BottomSheetTouchableOpacity
              key={option.id}
              onPress={() => onChange(option.id)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${labelPrefix}: ${option.id}`}
              style={{
                width: RING,
                height: RING,
                borderRadius: RING / 2,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 2,
                borderColor: ringColor,
              }}
            >
              <View
                style={{
                  width: SIZE,
                  height: SIZE,
                  borderRadius: SIZE / 2,
                  overflow: "hidden",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor:
                    option.kind === "solid" ? option.colors[0] : undefined,
                }}
              >
                {option.kind === "gradient" ? (
                  <LinearGradient
                    colors={
                      option.colors as readonly [string, string, ...string[]]
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : null}
                {selected ? (
                  <View
                    style={{
                      position: "absolute",
                      width: SIZE,
                      height: SIZE,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(0,0,0,0.28)",
                    }}
                  >
                    <Check size={24} weight="bold" color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
            </BottomSheetTouchableOpacity>
          );
        })}
      </View>
    </BottomSheetScrollView>
  );
}
