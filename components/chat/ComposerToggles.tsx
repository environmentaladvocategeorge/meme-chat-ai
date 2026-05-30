import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import {
  Gif as GifIcon,
  Keyboard as KeyboardIcon,
  Sticker,
} from "phosphor-react-native";
import { Pressable, StyleSheet, View } from "react-native";

// The memes affordance that sits just under the composer. A chunky little
// "sticker" chip: a rounded square icon badge + label. When the strip is open
// it fills with the brand gradient and lifts; closed, it's a soft card chip.
// Squishes on press so it feels tactile and playful rather than form-y.
export function MemeToggleButton({
  label,
  open,
  onPress,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      hitSlop={8}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        borderRadius: 16,
        overflow: "hidden",
        // A gentle squish + dip on press; the open chip rides a touch higher
        // so its lift reads as "on".
        transform: [
          { scale: pressed ? 0.95 : 1 },
          { translateY: pressed ? 1 : open ? -1 : 0 },
        ],
        // Soft colored glow under the open (gradient) chip for a bit of pop.
        shadowColor: open ? theme["--color-primary"] : "#000000",
        shadowOpacity: open ? 0.32 : 0.08,
        shadowRadius: open ? 10 : 5,
        shadowOffset: { width: 0, height: open ? 4 : 2 },
        elevation: open ? 4 : 1,
      })}
    >
      {open ? (
        <LinearGradient
          colors={gradient.colors}
          start={gradient.start}
          end={gradient.end}
          style={StyleSheet.absoluteFillObject}
        />
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 7,
          paddingRight: 14,
          paddingVertical: 7,
          borderRadius: 16,
          borderWidth: open ? 0 : 1,
          borderColor: theme["--color-border"],
          backgroundColor: open ? "transparent" : theme["--color-card"],
        }}
      >
        {/* Icon badge — a little rounded-square "sticker" that flips colors
            with the open state. While the strip is open the chip becomes a
            "back to keyboard" affordance, so the glyph swaps to a keyboard. */}
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: open
              ? "rgba(255,255,255,0.22)"
              : theme["--color-primary-subtle"],
            transform: [{ rotate: open ? "0deg" : "-8deg" }],
          }}
        >
          {open ? (
            <KeyboardIcon size={18} color="#FFFFFF" weight="fill" />
          ) : (
            <Sticker size={18} color={theme["--color-primary"]} weight="fill" />
          )}
        </View>
        <Typography
          variant="body-sm"
          weight="bold"
          style={{
            color: open ? "#FFFFFF" : theme["--color-foreground"],
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Typography>
      </View>
    </Pressable>
  );
}

// The GIF affordance that sits beside the meme chip. Same chunky sticker-chip
// language as MemeToggleButton, but wears a GIF badge and toggles the GIF
// drawer. Filled with the brand gradient + lifted when open.
export function GifToggleButton({
  label,
  open,
  onPress,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      hitSlop={8}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        borderRadius: 16,
        overflow: "hidden",
        transform: [
          { scale: pressed ? 0.95 : 1 },
          { translateY: pressed ? 1 : open ? -1 : 0 },
        ],
        shadowColor: open ? theme["--color-primary"] : "#000000",
        shadowOpacity: open ? 0.32 : 0.08,
        shadowRadius: open ? 10 : 5,
        shadowOffset: { width: 0, height: open ? 4 : 2 },
        elevation: open ? 4 : 1,
      })}
    >
      {open ? (
        <LinearGradient
          colors={gradient.colors}
          start={gradient.start}
          end={gradient.end}
          style={StyleSheet.absoluteFillObject}
        />
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 7,
          paddingRight: 14,
          paddingVertical: 7,
          borderRadius: 16,
          borderWidth: open ? 0 : 1,
          borderColor: theme["--color-border"],
          backgroundColor: open ? "transparent" : theme["--color-card"],
        }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: open
              ? "rgba(255,255,255,0.22)"
              : theme["--color-primary-subtle"],
            transform: [{ rotate: "-8deg" }],
          }}
        >
          <GifIcon
            size={18}
            color={open ? "#FFFFFF" : theme["--color-primary"]}
            weight="fill"
          />
        </View>
        <Typography
          variant="body-sm"
          weight="bold"
          style={{
            color: open ? "#FFFFFF" : theme["--color-foreground"],
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Typography>
      </View>
    </Pressable>
  );
}

// Emoji shown on the Rot Level chip per tier — mirrors RotLevelSheet's set so
// the chip previews the vibe that's currently dialed in.
const ROT_EMOJI = ["🤓", "😤", "💀"];

// The "Rot Level" affordance that sits beside the meme chip. Same chunky
// sticker-chip language as MemeToggleButton, but instead of a toggle it opens
// the rot-level bottom sheet. The icon badge wears the current level's emoji.
export function RotLevelButton({
  label,
  level,
  onPress,
}: {
  label: string;
  level: number;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${level}`}
      hitSlop={8}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        borderRadius: 16,
        overflow: "hidden",
        transform: [
          { scale: pressed ? 0.95 : 1 },
          { translateY: pressed ? 1 : 0 },
        ],
        shadowColor: "#000000",
        shadowOpacity: 0.08,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
      })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 7,
          paddingRight: 14,
          paddingVertical: 7,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme["--color-border"],
          backgroundColor: theme["--color-card"],
        }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme["--color-primary-subtle"],
          }}
        >
          <Typography variant="body" style={{ fontSize: 16 }}>
            {ROT_EMOJI[Math.min(Math.max(level, 1), 3) - 1]}
          </Typography>
        </View>
        <Typography
          variant="body-sm"
          weight="bold"
          style={{ color: theme["--color-foreground"], letterSpacing: 0.2 }}
        >
          {label}
        </Typography>
      </View>
    </Pressable>
  );
}
