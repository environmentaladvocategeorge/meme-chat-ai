// A single selectable bot row in the PersonaSheet list: glass card, avatar,
// name + description, and the two checkmark languages (left selection circle in
// delete-selection mode, right "active chat persona" check otherwise).

import { AppPressable } from "@/components/AppPressable";
import { GlassSurface } from "@/components/GlassSurface";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { Check, CheckCircle } from "phosphor-react-native";
import { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";

export function PersonaRow({
  name,
  description,
  avatar,
  active,
  selectionMode = false,
  marked = false,
  deletable = false,
  onPress,
  onLongPress,
  selectA11y,
}: {
  name: string;
  description?: string;
  avatar: ReactNode;
  active: boolean;
  selectionMode?: boolean;
  marked?: boolean;
  deletable?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  selectA11y: string;
}) {
  const theme = useTheme();
  // The default bot can't be marked, so in selection mode it reads as inert —
  // dimmed and unresponsive — rather than pretending to be selectable.
  const inert = selectionMode && !deletable;
  return (
    <AppPressable
      onPress={onPress}
      onLongPress={deletable ? onLongPress : undefined}
      delayLongPress={260}
      disabled={inert}
      accessibilityLabel={selectA11y}
      accessibilityState={{ selected: selectionMode ? marked : active }}
      pressScale={0.02}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        overflow: "hidden",
        opacity: inert ? 0.5 : 1,
      }}
    >
      {/* Glass surface where supported; solid card + border is the fallback.
          A primary tint marks the delete-selection (glass-safe — a border on a
          GlassView kills the material, so the active edge lives on the fallback
          and the glass relies on the tint + the trailing check). */}
      <GlassSurface
        pointerEvents="none"
        tintColor={marked ? theme["--color-primary-subtle"] : undefined}
        style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
        fallbackStyle={{
          backgroundColor: marked
            ? theme["--color-primary-subtle"]
            : theme["--color-card"],
          borderWidth: 1,
          borderColor:
            marked || active
              ? theme["--color-primary"]
              : theme["--color-border"],
        }}
      />

      {/* Left selection indicator — fades in/out with selection mode, only for
          deletable rows. */}
      {selectionMode && deletable ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
        >
          {marked ? (
            <CheckCircle
              size={24}
              color={theme["--color-primary"]}
              weight="fill"
            />
          ) : (
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                borderWidth: 2,
                borderColor: theme["--color-foreground-muted"],
              }}
            />
          )}
        </Animated.View>
      ) : null}

      {avatar}

      {/* Layout transition slides the title as the indicator's space appears or
          disappears, instead of jumping. */}
      <Animated.View
        layout={LinearTransition.duration(200)}
        style={{ flex: 1, gap: 2 }}
      >
        <Typography
          variant="body"
          weight="semibold"
          numberOfLines={1}
          style={{ color: theme["--color-foreground"] }}
        >
          {name}
        </Typography>
        {description ? (
          <Typography
            variant="caption"
            numberOfLines={1}
            style={{ color: theme["--color-foreground-secondary"] }}
          >
            {description}
          </Typography>
        ) : null}
      </Animated.View>

      {/* Right "active chat persona" check — hidden in selection mode so the two
          checkmark languages never collide. */}
      <View
        style={{
          width: 24,
          height: 24,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!selectionMode && active ? (
          <Check size={20} weight="bold" color={theme["--color-primary"]} />
        ) : null}
      </View>
    </AppPressable>
  );
}
