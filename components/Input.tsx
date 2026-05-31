import { useTheme } from "@/hooks/useTheme";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { forwardRef } from "react";
import { TextInput, TextInputProps, View } from "react-native";
import { Typography } from "./Typography";

interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string | null;
  // "glass" renders translucent white-on-gradient styling for the auth
  // screens that sit over the brand gradient; "default" is the standard
  // theme-surfaced field used everywhere else.
  tone?: "default" | "glass";
  // When rendered inside a @gorhom bottom sheet, swap the plain TextInput for
  // BottomSheetTextInput so focus + keyboard avoidance is handled by the sheet.
  bottomSheet?: boolean;
}

// Glass palette is fixed (not theme-derived) because it always sits over the
// dark brand gradient, in both light and dark mode.
const GLASS = {
  label: "rgba(255,255,255,0.86)",
  background: "rgba(255,255,255,0.1)",
  border: "rgba(255,255,255,0.28)",
  borderError: "#FF9DB0",
  text: "#FFFFFF",
  placeholder: "rgba(255,255,255,0.5)",
  error: "#FFC2CC",
} as const;

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, placeholder, tone = "default", bottomSheet = false, ...rest },
  ref,
) {
  const theme = useTheme();
  const isGlass = tone === "glass";
  const Field = bottomSheet ? BottomSheetTextInput : TextInput;

  const labelColor = isGlass ? GLASS.label : theme["--color-foreground-secondary"];
  const errorColor = isGlass ? GLASS.error : theme["--color-error"];

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Typography variant="label" style={{ color: labelColor }}>
          {label}
        </Typography>
      ) : null}
      <Field
        ref={ref as never}
        placeholder={placeholder}
        placeholderTextColor={
          isGlass ? GLASS.placeholder : theme["--color-foreground-muted"]
        }
        style={{
          height: isGlass ? 50 : 44,
          borderRadius: isGlass ? 16 : 14,
          paddingHorizontal: 16,
          backgroundColor: isGlass ? GLASS.background : theme["--color-input"],
          borderWidth: isGlass ? 1.5 : 1,
          borderColor: error
            ? isGlass
              ? GLASS.borderError
              : theme["--color-error"]
            : isGlass
              ? GLASS.border
              : theme["--color-border"],
          color: isGlass ? GLASS.text : theme["--color-foreground"],
          fontFamily: "Poppins-Regular",
          fontSize: 15,
        }}
        {...rest}
      />
      {error ? (
        <Typography variant="caption" style={{ color: errorColor }}>
          {error}
        </Typography>
      ) : null}
    </View>
  );
});
