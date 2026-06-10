import { isUpdateRequired } from "@/domain/appVersion";
import { fetchAppConfig } from "@/services/firebase/appConfig";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { create } from "zustand";

// Fallback App Store listing, used when the remote config omits a URL.
const DEFAULT_IOS_STORE_URL =
  "https://apps.apple.com/app/meme-chat-ai-brainrot-bot/id6774211629";

// The installed binary's marketing version. Each build embeds its own app.json
// `version`, so this equals the version the user actually has installed.
function installedVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

type AppUpdateState = {
  // Whether the check has finished (success or fail-open).
  checked: boolean;
  // True only when we positively confirmed the install is below the floor.
  updateRequired: boolean;
  // Where "Go to App Store" sends the user.
  storeUrl: string;
  check: () => Promise<void>;
};

export const useAppUpdateStore = create<AppUpdateState>()((set) => ({
  checked: false,
  updateRequired: false,
  storeUrl: DEFAULT_IOS_STORE_URL,
  // Reads the remote floor and compares it to the installed build. Only iOS has
  // a published listing to gate against today, so other platforms always pass.
  // Fails open on any error (handled inside fetchAppConfig + isUpdateRequired)
  // so a network blip can never brick the app.
  check: async () => {
    if (Platform.OS !== "ios") {
      set({ checked: true, updateRequired: false });
      return;
    }
    const config = await fetchAppConfig();
    set({
      checked: true,
      storeUrl: config?.iosAppStoreUrl || DEFAULT_IOS_STORE_URL,
      updateRequired: isUpdateRequired({
        installedVersion: installedVersion(),
        minRequiredVersion: config?.minIosVersion ?? null,
      }),
    });
  },
}));
