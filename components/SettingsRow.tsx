import { useTheme } from "@/hooks/useTheme";
import { ReactNode } from "react";
import { View } from "react-native";
import { Typography } from "./Typography";

interface SettingsRowProps {
  label: string;
  description?: string;
  children?: ReactNode;
}

export function SettingsRow({
  label,
  description,
  children,
}: SettingsRowProps) {
  const theme = useTheme();

  return (
    <View
      style={{
        borderRadius: 16,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: theme["--color-border"],
        padding: 16,
        gap: 10,
      }}
    >
      <View style={{ gap: 4 }}>
        <Typography
          variant="title-sm"
          style={{ color: theme["--color-foreground"] }}
        >
          {label}
        </Typography>
        {description ? (
          <Typography
            variant="caption"
            style={{ color: theme["--color-foreground-secondary"] }}
          >
            {description}
          </Typography>
        ) : null}
      </View>
      {children}
    </View>
  );
}
