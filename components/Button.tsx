import { themes } from "@/nativewind-theme";
import { useColorScheme } from "nativewind";
import { IconProps } from "phosphor-react-native";
import { ComponentType } from "react";
import {
  ActivityIndicator,
  TouchableOpacity,
  TouchableOpacityProps,
  View,
} from "react-native";
import { Typography } from "./Typography";

interface ButtonProps
  extends Pick<
    TouchableOpacityProps,
    "accessibilityLabel" | "disabled" | "hitSlop" | "style"
  > {
  title?: string;
  onPress: NonNullable<TouchableOpacityProps["onPress"]>;
  variant?: "primary" | "ghost" | "outline";
  size?: "default" | "small";
  startIcon?: ComponentType<IconProps>;
  endIcon?: ComponentType<IconProps>;
  loading?: boolean;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "default",
  startIcon: StartIcon,
  endIcon: EndIcon,
  disabled,
  loading,
  style,
  accessibilityLabel,
  hitSlop,
}: ButtonProps) {
  const { colorScheme } = useColorScheme();
  const theme = themes[colorScheme ?? "light"];

  const isPrimary = variant === "primary";
  const isOutline = variant === "outline";
  const isSmall = size === "small";
  const iconOnly = title === undefined || title.length === 0;
  const height = isSmall ? 38 : 44;
  const isDisabled = disabled || loading;

  const foregroundColor = isPrimary
    ? theme["--color-primary-foreground"]
    : isOutline
      ? theme["--color-primary"]
      : theme["--color-foreground"];
  const backgroundColor = isPrimary
    ? theme["--color-primary"]
    : isOutline
      ? theme["--color-background"]
      : theme["--color-background-secondary"];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ busy: loading }}
      hitSlop={hitSlop}
      activeOpacity={0.82}
      style={[
        {
          width: iconOnly ? height : undefined,
          height,
          borderRadius: 14,
          paddingHorizontal: iconOnly ? 0 : isSmall ? 10 : 14,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor,
          borderWidth: isPrimary ? 0 : 1,
          borderColor: isOutline
            ? theme["--color-primary"]
            : theme["--color-border"],
          opacity: isDisabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foregroundColor} />
      ) : (
        <>
          {StartIcon ? (
            <View style={{ marginRight: iconOnly ? 0 : isSmall ? 5 : 8 }}>
              <StartIcon
                size={isSmall ? 17 : 20}
                color={foregroundColor}
                weight="bold"
              />
            </View>
          ) : null}

          {!iconOnly && (
            <Typography
              variant={isSmall ? "caption" : "label"}
              style={{
                color: foregroundColor,
                fontWeight: "600",
                fontSize: isSmall ? 12 : undefined,
              }}
            >
              {title}
            </Typography>
          )}

          {EndIcon && (
            <View style={{ marginLeft: iconOnly ? 0 : isSmall ? 5 : 8 }}>
              <EndIcon
                size={isSmall ? 17 : 20}
                color={foregroundColor}
                weight="bold"
              />
            </View>
          )}
        </>
      )}
    </TouchableOpacity>
  );
}
