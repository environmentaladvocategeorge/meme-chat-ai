import { Typography } from "@/components/Typography";
import { Brain, CaretRight } from "phosphor-react-native";
import { Pressable, View } from "react-native";

// Subtle "Memory is on" hint shown atop a fresh chat for paid users who have
// memory enabled. The whole row is the button — tapping it opens the Memory
// sheet so they can review or switch it off. Hidden entirely when memory is
// off, so its presence always means "on".
export function MemoryOnBanner({
  label,
  a11yLabel,
  color,
  onPress,
}: {
  label: string;
  a11yLabel: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <View style={{ alignItems: "center", paddingTop: 8 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        hitSlop={8}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          paddingVertical: 4,
          paddingHorizontal: 10,
        }}
      >
        <Brain size={13} weight="fill" color={color} />
        <Typography variant="caption" weight="semibold" style={{ color }}>
          {label}
        </Typography>
        <CaretRight size={11} weight="bold" color={color} />
      </Pressable>
    </View>
  );
}
