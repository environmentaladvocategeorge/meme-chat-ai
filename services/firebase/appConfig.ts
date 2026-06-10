import { doc, getDoc, type DocumentData } from "firebase/firestore";
import { getFirebaseServices } from "./app";

// Remote app config (Firestore `config/app`). Publicly readable so the
// force-update gate works before sign-in. Keep this doc tiny.
export type AppConfig = {
  // Lowest iOS build allowed into the app. Installs below this are forced to
  // update. Null/absent means "no floor" (gate stays open).
  minIosVersion: string | null;
  // App Store listing to send users to when they're behind.
  iosAppStoreUrl: string | null;
};

// One-shot read of the remote config. Returns null on any failure (missing
// Firebase, offline, permission, parse error) so the caller fails open.
export async function fetchAppConfig(): Promise<AppConfig | null> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return null;
  try {
    const snap = await getDoc(doc(firebase.services.firestore, "config", "app"));
    if (!snap.exists()) return null;
    const d = snap.data() as DocumentData;
    return {
      minIosVersion:
        typeof d.minIosVersion === "string" ? d.minIosVersion : null,
      iosAppStoreUrl:
        typeof d.iosAppStoreUrl === "string" ? d.iosAppStoreUrl : null,
    };
  } catch {
    return null;
  }
}
