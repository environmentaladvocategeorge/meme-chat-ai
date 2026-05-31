import Constants from "expo-constants";
import { Platform } from "react-native";

let initializationStarted = false;

export function canUseNativeAds() {
  return Platform.OS !== "web" && Constants.appOwnership !== "expo";
}

export async function initializeMobileAds() {
  if (initializationStarted || !canUseNativeAds()) return;

  initializationStarted = true;

  try {
    const { default: mobileAds } = await import("react-native-google-mobile-ads");
    await mobileAds().initialize();
  } catch {
    initializationStarted = false;
  }
}
