import { parseCustomColor, type Swatch } from "@/domain/customization";
import { useTheme } from "@/hooks/useTheme";
import { TouchableOpacity as BottomSheetTouchableOpacity } from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Plus } from "phosphor-react-native";
import { View } from "react-native";

const SIZE = 52;
// Outer swatch incl. its 2px selection ring + 4px breathing room.
const RING = SIZE + 6;
const GAP = 12;

// A multi-stop sweep used on the empty "custom" swatch so it reads as "pick any
// color" at a glance.
const RAINBOW = [
  "#FF3B30",
  "#FF9500",
  "#FFCC00",
  "#34C759",
  "#0A84FF",
  "#5E5CE6",
  "#FF2D55",
] as const;

interface SwatchPickerProps {
  options: readonly Swatch[];
  value: string;
  onChange: (id: string) => void;
  // Tapping the trailing "custom" swatch opens the color picker instead of
  // committing a value.
  onCustomPress: () => void;
  // Accessible label prefix per swatch, e.g. "Message style".
  labelPrefix: string;
  customLabel: string;
}

// A wrapping grid of selectable color/gradient swatches: as many per row as fit
// the width, flowing onto new rows. The selected swatch gets a ring + check
// overlay. Vertical scrolling is owned by the parent sheet (each control now has
// its own page), so this is a plain wrapping View rather than its own scroller.
export function SwatchPicker({
  options,
  value,
  onChange,
  onCustomPress,
  labelPrefix,
  customLabel,
}: SwatchPickerProps) {
  const theme = useTheme();
  // A custom value (custom:#RRGGBB) marks the trailing custom swatch selected
  // and gives it the picked color to display.
  const activeCustom = parseCustomColor(value);

  return (
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: GAP,
        }}
      >
        {options.map((option) => {
          const isCustom = option.kind === "custom";
          const selected = isCustom
            ? activeCustom !== null
            : option.id === value;
          const ringColor = selected
            ? theme["--color-primary"]
            : theme["--color-border"];

          // The custom swatch shows the picked color once chosen, otherwise the
          // rainbow + a plus to invite a pick. Its check sits in whichever
          // on-color reads on the fill.
          const customFill = isCustom ? activeCustom : null;

          return (
            <BottomSheetTouchableOpacity
              key={option.id}
              onPress={() =>
                isCustom ? onCustomPress() : onChange(option.id)
              }
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={
                isCustom ? customLabel : `${labelPrefix}: ${option.id}`
              }
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
                    option.kind === "solid"
                      ? option.colors[0]
                      : (customFill ?? undefined),
                }}
              >
                {option.kind === "gradient" ? (
                  <LinearGradient
                    colors={option.colors}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : null}

                {isCustom && !customFill ? (
                  <LinearGradient
                    colors={RAINBOW}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : null}

                {isCustom && !customFill ? (
                  // A plus glyph over a soft scrim so it reads on any rainbow hue.
                  <View
                    style={{
                      position: "absolute",
                      width: SIZE,
                      height: SIZE,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <View
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "rgba(0,0,0,0.32)",
                      }}
                    >
                      <Plus size={16} weight="bold" color="#FFFFFF" />
                    </View>
                  </View>
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
  );
}
