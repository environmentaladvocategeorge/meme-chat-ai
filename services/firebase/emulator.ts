type ExpoConstants = {
  expoConfig?: { hostUri?: string } | null;
  manifest?: { debuggerHost?: string } | null;
};

// Local Firebase Emulator Suite wiring. Gated behind a build-time flag so
// production bundles never point at a local host. Flip it on by creating a
// root `.env.local` with EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true (see
// docs/local-dev.md); delete that file to return to the real project.
export const USE_FIREBASE_EMULATOR =
  process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR === "true";

// Must match the ports declared under "emulators" in firebase.json.
export const EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  functions: 5001,
  storage: 9199,
} as const;

// The emulators run on the dev machine. The iOS simulator can reach it via
// "localhost", but Android emulators and physical devices can't — so derive the
// LAN host Metro is already serving from (Constants.expoConfig.hostUri looks
// like "192.168.1.20:8081"). An explicit EXPO_PUBLIC_EMULATOR_HOST always wins.
export function getEmulatorHost(): string {
  const override = process.env.EXPO_PUBLIC_EMULATOR_HOST?.trim();
  if (override) return override;

  // Required lazily: expo-constants is a native module that the pure-logic test
  // runner can't load, and this only runs in emulator mode on a real device/sim.
  const Constants = (
    require("expo-constants") as {
      default?: ExpoConstants;
    } & ExpoConstants
  ).default ?? require("expo-constants");

  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Older manifest shape; still present at runtime on some Expo setups.
    Constants.manifest?.debuggerHost ??
    "";

  const host = hostUri.split(":")[0];
  return host.length > 0 ? host : "localhost";
}
