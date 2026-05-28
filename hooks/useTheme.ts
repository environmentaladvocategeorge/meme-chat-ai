import { themes } from "@/nativewind-theme";
import { useColorScheme } from "nativewind";

export function useTheme() {
  const { colorScheme } = useColorScheme();
  return themes[colorScheme ?? "light"];
}
