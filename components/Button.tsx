import { AppPressable } from "@/components/AppPressable";
import { themes } from "@/nativewind-theme";
import { useColorScheme } from "nativewind";
import { IconProps } from "phosphor-react-native";
import { ComponentType } from "react";
import {
  ActivityIndicator,
  StyleProp,
  View,
  ViewStyle,
} from "react-native";
import { Typography } from "./Typography";

interface ButtonProps {
  title?: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "outline";
  size?: "default" | "small";
  startIcon?: ComponentType<IconProps>;
  endIcon?: ComponentType<IconProps>;
  loading?: boolean;
  disabled?: boolean;
  // Layout style for the button (flex / margin / width / alignSelf). The
  // visual box (height / radius / fill) is owned internally.
  style?: StyleProp<ViewStyle>;
  hitSlop?: number;
  accessibilityLabel?: string;
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
    <AppPressable
      onPress={onPress}
      disabled={isDisabled}
      feedback="opacity"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ busy: loading }}
      hitSlop={hitSlop}
      // The disabled dim MUST live on the outer container: feedback="opacity"
      // applies its own opacity to the inner animated view (style below), which
      // would otherwise override a disabled opacity set there and leave the
      // button looking fully active. The outer container is never touched by the
      // press feedback, so 0.4 here actually shows.
      containerStyle={[style, isDisabled ? { opacity: 0.4 } : null]}
      style={{
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
      }}
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
    </AppPressable>
  );
}
