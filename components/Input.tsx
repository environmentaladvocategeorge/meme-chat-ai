import { useTheme } from "@/hooks/useTheme";
import { forwardRef } from "react";
import { TextInput, TextInputProps, View } from "react-native";
import { Typography } from "./Typography";

interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string | null;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, placeholder, ...rest },
  ref,
) {
  const theme = useTheme();

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Typography
          variant="label"
          style={{ color: theme["--color-foreground-secondary"] }}
        >
          {label}
        </Typography>
      ) : null}
      <TextInput
        ref={ref}
        placeholder={placeholder}
        placeholderTextColor={theme["--color-foreground-muted"]}
        style={{
          height: 44,
          borderRadius: 14,
          paddingHorizontal: 14,
          backgroundColor: theme["--color-input"],
          borderWidth: 1,
          borderColor: error
            ? theme["--color-error"]
            : theme["--color-border"],
          color: theme["--color-foreground"],
          fontFamily: "Poppins-Regular",
          fontSize: 14,
        }}
        {...rest}
      />
      {error ? (
        <Typography
          variant="caption"
          style={{ color: theme["--color-error"] }}
        >
          {error}
        </Typography>
      ) : null}
    </View>
  );
});
