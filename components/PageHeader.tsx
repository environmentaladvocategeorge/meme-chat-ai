import { useTheme } from "@/hooks/useTheme";
import { View } from "react-native";
import { Typography } from "./Typography";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  const theme = useTheme();

  return (
    <View style={{ gap: 6 }}>
      <Typography
        variant="title-xl"
        style={{ color: theme["--color-foreground"] }}
      >
        {title}
      </Typography>
      {subtitle ? (
        <Typography
          variant="body"
          style={{ color: theme["--color-foreground-secondary"] }}
        >
          {subtitle}
        </Typography>
      ) : null}
    </View>
  );
}
