// OnboardingComposer
//
// A focused, single-purpose text composer for the one free-text turn in
// conversational onboarding (the "what should I call you?" name capture). It
// deliberately is NOT the live ChatInput — that component is wired to streaming,
// media pickers, rot toggles and the chat store, none of which belong mid-
// onboarding. This matches ChatInput's LOOK (rounded surface + circular gradient
// send) without any of that machinery: just text in, one send out.

import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/nativewind-theme";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { PaperPlaneTilt } from "phosphor-react-native";
import { Pressable, TextInput, View } from "react-native";

export function OnboardingComposer({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  maxLength,
  autoFocus,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const primary = gradients[colorScheme ?? "light"].primary;
  const canSend = value.trim().length > 0;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      <View
        style={{
          flex: 1,
          minHeight: 48,
          borderRadius: 24,
          paddingHorizontal: 18,
          justifyContent: "center",
          backgroundColor: theme["--color-input"],
          borderWidth: 1,
          borderColor: theme["--color-border"],
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme["--color-foreground-muted"]}
          maxLength={maxLength}
          autoFocus={autoFocus}
          autoCapitalize="words"
          returnKeyType="send"
          onSubmitEditing={() => {
            if (canSend) onSubmit();
          }}
          style={{
            paddingVertical: 12,
            color: theme["--color-foreground"],
            fontFamily: "Poppins-Regular",
            fontSize: 15,
          }}
        />
      </View>

      <Pressable
        onPress={() => {
          if (canSend) onSubmit();
        }}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        hitSlop={8}
        style={{ opacity: canSend ? 1 : 0.4 }}
      >
        <LinearGradient
          colors={primary.colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PaperPlaneTilt size={22} color="#FFFFFF" weight="fill" />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

// Small inline skip affordance shown beside the composer ("skip, stay
// mysterious"). A plain text button so it reads as secondary to send.
export function ComposerSkip({
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
      style={{ alignSelf: "center", paddingVertical: 8 }}
    >
      <Typography
        variant="caption"
        style={{ color: theme["--color-foreground-muted"] }}
      >
        {label}
      </Typography>
    </Pressable>
  );
}
