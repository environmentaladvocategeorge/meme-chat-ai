import { Linking } from "react-native";

export const MEME_CHAT_APP_STORE_URL =
  "https://apps.apple.com/app/id6774211629";
export const MEME_CHAT_APP_STORE_REVIEW_URL =
  "https://apps.apple.com/app/id6774211629?action=write-review";

export async function openAppStoreReview(): Promise<void> {
  const reviewSupported = await Linking.canOpenURL(MEME_CHAT_APP_STORE_REVIEW_URL);
  if (reviewSupported) {
    await Linking.openURL(MEME_CHAT_APP_STORE_REVIEW_URL);
    return;
  }
  const storeSupported = await Linking.canOpenURL(MEME_CHAT_APP_STORE_URL);
  if (storeSupported) {
    await Linking.openURL(MEME_CHAT_APP_STORE_URL);
  }
}
