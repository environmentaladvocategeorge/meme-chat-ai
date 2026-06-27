// PersonaToggleRow
//
// The "let {bot} do X on its own" switch used on the greetings (autoGreet),
// reactions (autoMedia), and word-bank (autoWordBank) steps. A labeled card row
// with a Switch — extracted so the three stay byte-for-byte identical.

import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { Switch, View } from "react-native";

export function PersonaToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
      }}
    >
      <Typography
        variant="body-sm"
        weight="medium"
        style={{ flex: 1, color: theme["--color-foreground"] }}
      >
        {label}
      </Typography>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          true: theme["--color-primary"],
          false: theme["--color-border-strong"],
        }}
        thumbColor={theme["--color-card"]}
      />
    </View>
  );
}
