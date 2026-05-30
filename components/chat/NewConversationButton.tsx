import { useTheme } from "@/hooks/useTheme";
import { NotePencil } from "phosphor-react-native";
import { Pressable } from "react-native";

// Right-hand header action on the chat screen: starts a fresh conversation.
// Deliberately a softer treatment than the gradient menu button — a muted
// outlined circle — so it reads as secondary and doesn't fight for attention.
export function NewConversationButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: theme["--color-border"],
        backgroundColor: pressed
          ? theme["--color-card-pressed"]
          : theme["--color-card-muted"],
      })}
    >
      <NotePencil size={20} color={theme["--color-foreground"]} weight="bold" />
    </Pressable>
  );
}
