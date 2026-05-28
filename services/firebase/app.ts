import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import * as FirebaseAuth from "@firebase/auth";
import { FirebaseError } from "firebase/app";
import type { Auth, Persistence } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";
import { getStorage, type FirebaseStorage } from "firebase/storage";

type FirebaseServices = {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
};

type FirebaseServiceResult =
  | { available: true; services: FirebaseServices }
  | {
      available: false;
      reason: "missing-config" | "initialization-failed";
      error?: unknown;
    };

let cachedServices: FirebaseServiceResult | null = null;

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim() ?? "";

  if (
    trimmed.length === 0 ||
    trimmed.startsWith("REPLACE_WITH_") ||
    trimmed.includes("YOUR_") ||
    trimmed.includes("PLACEHOLDER")
  ) {
    return "";
  }

  return trimmed;
}

function getFirebaseConfig() {
  // Expo's babel plugin only inlines STATIC `process.env.EXPO_PUBLIC_*`
  // references at bundle time. Dynamic indexing like `process.env[key]` is
  // not inlined and returns undefined in production builds.
  const apiKey = cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);
  const projectId = cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  const appId = cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_APP_ID);

  if (apiKey === "" || projectId === "" || appId === "") return null;

  return {
    apiKey,
    authDomain: cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId,
    storageBucket: cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: cleanEnv(
      process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    ),
    appId,
  };
}

function getInitializedAuth(app: FirebaseApp) {
  const authModule = FirebaseAuth as typeof FirebaseAuth & {
    getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence;
  };
  const getReactNativePersistence = authModule.getReactNativePersistence;

  if (!getReactNativePersistence) {
    throw new Error("Firebase React Native auth persistence is unavailable.");
  }

  try {
    return FirebaseAuth.initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error) {
    if (
      error instanceof FirebaseError &&
      error.code === "auth/already-initialized"
    ) {
      return FirebaseAuth.getAuth(app);
    }

    throw error;
  }
}

export function getFirebaseServices(): FirebaseServiceResult {
  if (cachedServices) return cachedServices;

  const config = getFirebaseConfig();

  if (!config) {
    cachedServices = { available: false, reason: "missing-config" };
    return cachedServices;
  }

  try {
    const app = getApps().length > 0 ? getApp() : initializeApp(config);
    const auth = getInitializedAuth(app);
    const firestore = getFirestore(app);
    const functions = getFunctions(app);
    const storage = getStorage(app);

    cachedServices = {
      available: true,
      services: { app, auth, firestore, functions, storage },
    };
    return cachedServices;
  } catch (error) {
    cachedServices = {
      available: false,
      reason: "initialization-failed",
      error,
    };
    return cachedServices;
  }
}

export function resetFirebaseServicesForTests() {
  cachedServices = null;
}
