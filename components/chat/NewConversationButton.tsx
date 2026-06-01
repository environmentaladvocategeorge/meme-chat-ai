import { IconButton } from "@/components/IconButton";
import { useTheme } from "@/hooks/useTheme";
import { NotePencil } from "phosphor-react-native";

// Right-hand header action on the chat screen: starts a fresh conversation.
// Deliberately a softer treatment than the gradient menu button — a muted
// outlined circle — so it reads as secondary and doesn't fight for attention.
// Built on IconButton so it shares the app-wide static-target + inner-feedback
// touch core (the thing that keeps small targets reliable on Fabric release).
export function NewConversationButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <IconButton
      onPress={onPress}
      accessibilityLabel={label}
      size={40}
      hitSlop={16}
      surfaceStyle={{
        borderWidth: 1,
        borderColor: theme["--color-border"],
        backgroundColor: theme["--color-card-muted"],
      }}
    >
      <NotePencil size={20} color={theme["--color-foreground"]} weight="bold" />
    </IconButton>
  );
}
