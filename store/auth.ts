import { getFirebaseServices } from "@/services/firebase/app";
import {
  reauthenticateWithApple,
  SignInAppleResult,
  signInWithApple,
} from "@/services/firebase/appleAuth";
import { deleteMyAccountCallable } from "@/services/firebase/callables";
import {
  reauthenticateWithPassword,
  reloadEmailVerification,
  registerWithEmail,
  resendVerificationEmail,
  sendPasswordReset,
  signInWithEmail,
  type DeleteAccountError,
  type PasswordResetResult,
  type RegisterEmailResult,
  type ResendVerificationResult,
  type SignInEmailResult,
} from "@/services/firebase/emailAuth";
import { useOnboardingStore } from "@/store/onboarding";
import { useSettingsStore } from "@/store/settings";
import { wipeLocalAppData } from "@/store/storage";
import { FirebaseError } from "firebase/app";
import {
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type Unsubscribe,
  type User,
} from "firebase/auth";
import { create } from "zustand";

export type AuthSessionStatus =
  | "idle"
  | "firebaseUnavailable"
  | "initializing"
  | "signedOut"
  | "authenticated"
  | "deleting"
  | "error";

type AuthProviderInfo = {
  providerId: string;
  email?: string | null;
};

type AuthSessionState = {
  status: AuthSessionStatus;
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  providers: AuthProviderInfo[];
  error: string | null;
  unavailableReason: "missing-config" | "initialization-failed" | null;
  initializeAuthSession: () => Promise<void>;
  registerEmail: (
    email: string,
    password: string,
  ) => Promise<RegisterEmailResult>;
  signInEmail: (email: string, password: string) => Promise<SignInEmailResult>;
  signInApple: () => Promise<SignInAppleResult>;
  signOut: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<PasswordResetResult>;
  resendVerificationEmail: () => Promise<ResendVerificationResult>;
  refreshEmailVerified: () => Promise<boolean>;
  deleteAccount: (
    password: string,
  ) => Promise<
    { success: true } | { success: false; error: DeleteAccountError }
  >;
  deleteAccountWithApple: () => Promise<
    { success: true } | { success: false; error: DeleteAccountError }
  >;
};

let initializationPromise: Promise<void> | null = null;
let unsubscribeAuthState: Unsubscribe | null = null;

function getAuthErrorCode(error: unknown) {
  if (error instanceof FirebaseError) return error.code;
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }

  return "auth/unknown";
}

function mapUser(user: User) {
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    providers: user.providerData.map((provider) => ({
      providerId: provider.providerId,
      email: provider.email,
    })),
  };
}

const SIGNED_OUT_STATE = {
  uid: null,
  email: null,
  emailVerified: false,
  providers: [] as AuthProviderInfo[],
  error: null,
  unavailableReason: null,
} as const;

export const useAuthStore = create<AuthSessionState>()((set) => ({
  status: "idle",
  uid: null,
  email: null,
  emailVerified: false,
  providers: [],
  error: null,
  unavailableReason: null,

  initializeAuthSession: async () => {
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      const firebase = getFirebaseServices();

      if (!firebase.available) {
        set({
          status: "firebaseUnavailable",
          ...SIGNED_OUT_STATE,
          error:
            firebase.reason === "missing-config"
              ? "Firebase configuration is missing."
              : getAuthErrorCode(firebase.error),
          unavailableReason: firebase.reason,
        });
        return;
      }

      const { auth } = firebase.services;

      set({
        status: "initializing",
        error: null,
        unavailableReason: null,
      });

      if (!unsubscribeAuthState) {
        unsubscribeAuthState = onAuthStateChanged(
          auth,
          (user) => {
            if (!user) {
              // Don't override the deleting state — finalizeAccountDeletion
              // transitions to signedOut after local cleanup completes.
              if (useAuthStore.getState().status === "deleting") return;
              set({ status: "signedOut", ...SIGNED_OUT_STATE });
              return;
            }

            if (user.isAnonymous) {
              void firebaseSignOut(auth).catch(() => {});
              set({ status: "signedOut", ...SIGNED_OUT_STATE });
              return;
            }

            set({
              status: "authenticated",
              ...mapUser(user),
              error: null,
              unavailableReason: null,
            });
          },
          (error) => {
            set({ status: "error", error: getAuthErrorCode(error) });
          },
        );
      }

      try {
        await auth.authStateReady();

        const user = auth.currentUser;
        if (user && !user.isAnonymous) {
          set({
            status: "authenticated",
            ...mapUser(user),
            error: null,
            unavailableReason: null,
          });
          return;
        }

        if (user && user.isAnonymous) {
          await firebaseSignOut(auth).catch(() => {});
        }

        set({ status: "signedOut", ...SIGNED_OUT_STATE });
      } catch (error) {
        set({ status: "error", error: getAuthErrorCode(error) });
      }
    })().finally(() => {
      initializationPromise = null;
    });

    return initializationPromise;
  },

  registerEmail: async (email, password) => {
    const result = await registerWithEmail(email, password);

    if (result.success) {
      set({
        status: "authenticated",
        uid: result.uid,
        email: result.email,
        emailVerified: result.emailVerified,
        providers: [{ providerId: "password", email: result.email }],
        error: null,
        unavailableReason: null,
      });
    }

    return result;
  },

  signInEmail: async (email, password) => {
    const firebase = getFirebaseServices();
    if (!firebase.available)
      return { success: false, error: "generic" as const };

    const { auth } = firebase.services;
    await auth.authStateReady();

    const result = await signInWithEmail(email, password);

    if (result.success) {
      set({
        status: "authenticated",
        uid: result.uid,
        email: result.email,
        emailVerified: result.emailVerified,
        providers: [{ providerId: "password", email: result.email }],
        error: null,
      });
    }

    return result;
  },

  signInApple: async () => {
    const result = await signInWithApple();

    if (result.success) {
      set({
        status: "authenticated",
        uid: result.uid,
        email: result.email,
        emailVerified: result.emailVerified,
        providers: result.providers,
        error: null,
        unavailableReason: null,
      });
    }

    return result;
  },

  signOut: async () => {
    const firebase = getFirebaseServices();
    if (!firebase.available) {
      set({ status: "signedOut", ...SIGNED_OUT_STATE });
      return;
    }

    try {
      await firebaseSignOut(firebase.services.auth);
    } catch {}

    set({ status: "signedOut", ...SIGNED_OUT_STATE });
  },

  sendPasswordResetEmail: async (email) => sendPasswordReset(email),

  resendVerificationEmail: async () => resendVerificationEmail(),

  refreshEmailVerified: async () => {
    const verified = await reloadEmailVerification();
    if (verified) set({ emailVerified: true });
    return verified;
  },

  deleteAccount: async (password) => {
    const reauth = await reauthenticateWithPassword(password);
    if (!reauth.success) return reauth;

    const firebase = getFirebaseServices();
    if (!firebase.available)
      return { success: false, error: "generic" as const };

    return finalizeAccountDeletion(firebase.services.auth, set);
  },

  deleteAccountWithApple: async () => {
    const firebase = getFirebaseServices();
    if (!firebase.available)
      return { success: false, error: "generic" as const };

    const { auth } = firebase.services;
    await auth.authStateReady();
    if (!auth.currentUser) {
      return { success: false, error: "generic" as const };
    }

    const reauth = await reauthenticateWithApple();
    if (!reauth.success) {
      switch (reauth.error) {
        case "cancelled":
          return { success: false, error: "apple-cancelled" as const };
        case "unavailable":
        case "missing-identity-token":
        case "no-user":
          return { success: false, error: "apple-unavailable" as const };
        case "user-mismatch":
          return { success: false, error: "apple-user-mismatch" as const };
        case "network-request-failed":
        default:
          return { success: false, error: "reauth-failed" as const };
      }
    }

    return finalizeAccountDeletion(auth, set);
  },
}));

// Auth + Firestore deletion happen server-side; the JS SDK keeps the
// cached user in AsyncStorage until we explicitly sign out, so we still
// need to firebaseSignOut and wipe local storage on the client to leave
// nothing behind.
async function finalizeAccountDeletion(
  auth: import("firebase/auth").Auth,
  set: (partial: Partial<AuthSessionState> | AuthSessionState) => void,
): Promise<
  { success: true } | { success: false; error: DeleteAccountError }
> {
  try {
    await deleteMyAccountCallable();
  } catch (e) {
    console.warn("[deleteAccount] callable failed:", e);
    return { success: false, error: "firestore-delete-failed" as const };
  }

  set({ status: "deleting" });

  await firebaseSignOut(auth).catch(() => {});

  await wipeLocalAppData().catch(() => {});
  await useOnboardingStore.getState().reset().catch(() => {});
  await useSettingsStore.getState().reset().catch(() => {});

  set({ status: "signedOut", ...SIGNED_OUT_STATE });

  return { success: true as const };
}
