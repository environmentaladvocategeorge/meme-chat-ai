import { PlayfulMenu } from "@/components/PlayfulMenu";
import { useTheme } from "@/hooks/useTheme";
import { Stack } from "expo-router";
import { View } from "react-native";

export default function AppLayout() {
  const theme = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme["--color-background"] }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme["--color-background"] },
          animation: "fade",
        }}
      >
        <Stack.Screen name="chat" />
        <Stack.Screen name="history" />
        <Stack.Screen name="settings" />
      </Stack>
      <PlayfulMenu />
    </View>
  );
}
