import { getFirebaseServices } from "@/services/firebase/app";
import {
  reauthenticateWithApple,
  SignInAppleResult,
  signInWithApple,
} from "@/services/firebase/appleAuth";
import { deleteMyAccountCallable } from "@/services/firebase/callables";
import {
  changeUserEmail,
  changeUserPassword,
  reauthenticateWithPassword,
  reloadEmailVerification,
  registerWithEmail,
  resendVerificationEmail,
  sendPasswordReset,
  signInWithEmail,
  type ChangeEmailResult,
  type ChangePasswordResult,
  type DeleteAccountError,
  type PasswordResetResult,
  type RegisterEmailResult,
  type ResendVerificationResult,
  type SignInEmailResult,
} from "@/services/firebase/emailAuth";
import { fetchOnboardingCompleted } from "@/services/firebase/profile";
import { DEFAULT_PERSONA_ID } from "@/domain/personas";
import { useChatStore } from "@/store/chat";
import { useEntitlementStore } from "@/store/entitlement";
import { teardownUserNotifications } from "@/store/notifications";
import { useOnboardingStore } from "@/store/onboarding";
import { usePersonaStore } from "@/store/personas";
import { useReviewPromptStore } from "@/store/reviewPrompt";
import { useSettingsStore } from "@/store/settings";
import { listResidualUserKeys, wipeLocalAppData } from "@/store/storage";
import { useSubscriptionStore } from "@/store/subscription";
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
  changeEmail: (
    currentPassword: string,
    newEmail: string,
  ) => Promise<ChangeEmailResult>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<ChangePasswordResult>;
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

// In-flight onboarding restore, deduped by uid — the auth listener and an
// explicit sign-in call can both ask for it in the same beat.
let onboardingRestore: { uid: string; promise: Promise<void> } | null = null;

// The device-local onboarding flag is wiped on every sign-out and lost on
// reinstall, but the account's profile keeps the durable marker
// (profiles/{uid}.onboardingCompleted, written by the updateProfile callable
// when the flow finishes). Restore it BEFORE the session flips to
// authenticated so the router never bounces an established account back
// through /onboarding. No-ops synchronously when the local flag is already
// set, so the common cold start pays no extra read.
function restoreOnboardingFromProfile(uid: string): Promise<void> {
  if (useOnboardingStore.getState().completed) return Promise.resolve();
  if (onboardingRestore?.uid === uid) return onboardingRestore.promise;

  const promise = (async () => {
    const completed = await fetchOnboardingCompleted(uid);
    if (completed) useOnboardingStore.getState().markCompletedFromServer();
  })().finally(() => {
    onboardingRestore = null;
  });

  onboardingRestore = { uid, promise };
  return promise;
}

// Settles an auth-listener "user present" event into the authenticated state.
// Async because the onboarding restore must land first (see above); the
// re-check guards against the session changing while we awaited.
async function applyAuthenticatedSession(
  auth: import("firebase/auth").Auth,
  user: User,
  set: (partial: Partial<AuthSessionState>) => void,
): Promise<void> {
  // The profiles/{uid} rule requires email_verified, so the read can only
  // succeed for verified users — skip the guaranteed-denied roundtrip
  // otherwise (unverified users are routed to verify-email regardless).
  if (user.emailVerified) {
    await restoreOnboardingFromProfile(user.uid);
    if (auth.currentUser?.uid !== user.uid) return;
  }

  set({
    status: "authenticated",
    ...mapUser(user),
    error: null,
    unavailableReason: null,
  });
  // Bind the RevenueCat App User ID to the Firebase uid so the RC
  // webhook can resolve back to this user's Firestore profile.
  void useSubscriptionStore.getState().setRcUser(user.uid);
  // Subscribe to the user's billing profile so the UI can live-
  // update credit counts as the backend settles usage events.
  useEntitlementStore.getState().bindUid(user.uid);
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
              void useSubscriptionStore.getState().setRcUser(null);
              useEntitlementStore.getState().bindUid(null);
              return;
            }

            if (user.isAnonymous) {
              void firebaseSignOut(auth).catch(() => {});
              set({ status: "signedOut", ...SIGNED_OUT_STATE });
              void useSubscriptionStore.getState().setRcUser(null);
              useEntitlementStore.getState().bindUid(null);
              return;
            }

            void applyAuthenticatedSession(auth, user, set);
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
          if (user.emailVerified) await restoreOnboardingFromProfile(user.uid);
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
      // Pull the durable onboarding marker before the status flip so the
      // router's first decision for this session already sees it (the local
      // flag was wiped at the last sign-out). Verified-only: the profiles
      // rule denies unverified tokens, and those users route to verify-email.
      if (result.emailVerified) await restoreOnboardingFromProfile(result.uid);
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
      // Same durable-marker restore as the email path: an Apple re-sign-in on
      // an established account must not replay onboarding.
      if (result.emailVerified) await restoreOnboardingFromProfile(result.uid);
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
      await clearSignedOutLocalData();
      set({ status: "signedOut", ...SIGNED_OUT_STATE });
      return;
    }

    // Tear down the chat messages listener and clear the in-memory + persisted
    // chat session before the token is revoked, so the next signed-in user
    // starts clean and the previous user's conversation never bleeds across.
    // The entitlement listener and RevenueCat identity are cleared by the
    // onAuthStateChanged handler once firebaseSignOut fires.
    useChatStore.getState().startNewConversation();

    let signOutError: unknown;
    try {
      await firebaseSignOut(firebase.services.auth);
    } catch (err) {
      signOutError = err;
    }

    await clearSignedOutLocalData();

    if (signOutError) {
      console.warn("[auth] firebase sign-out failed:", signOutError);
    }

    set({ status: "signedOut", ...SIGNED_OUT_STATE });
  },

  changeEmail: async (currentPassword, newEmail) =>
    changeUserEmail(currentPassword, newEmail),

  changePassword: async (currentPassword, newPassword) =>
    changeUserPassword(currentPassword, newPassword),

  sendPasswordResetEmail: async (email) => sendPasswordReset(email),

  resendVerificationEmail: async () => resendVerificationEmail(),

  refreshEmailVerified: async () => {
    const wasVerified = useAuthStore.getState().emailVerified;
    const verified = await reloadEmailVerification();
    if (verified) {
      set({ emailVerified: true });
      // On the first transition to verified, the entitlement listener attached
      // at sign-in is dead — it hit permission-denied while the token still
      // said email_verified=false. reloadEmailVerification has just forced a
      // fresh token carrying the claim, so re-attach the listener now; without
      // this the chat sits on "Warming up" until a hard reload.
      if (!wasVerified) {
        useEntitlementStore.getState().rebind();
      }
    }
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
  // Tear down the active chat messages listener before the callable runs:
  // deleteMyAccount removes the auth user server-side first, which revokes the
  // token and would make any still-attached Firestore listener fire
  // permission-denied. (The history conversations listener unsubscribes on its
  // own once `uid` clears below.)
  useChatStore.getState().startNewConversation();

  // Flip to the `deleting` takeover NOW, before any irreversible work. The root
  // layout renders a full-screen, button-less "deleting your data" screen for
  // this status (over the account sheet), so the user can't navigate away,
  // cancel, or re-trigger the delete mid-wipe. Reauth already happened in the
  // sheet; the only way back out of this state is the callable failing below.
  set({ status: "deleting" });

  try {
    // Reauth bumps auth_time server-side but does NOT refresh the cached ID
    // token the callable attaches. If that cached token is already expired
    // (e.g. signed in over an hour ago) the function sees no valid auth and
    // rejects with `unauthenticated`. Force a fresh token first — same guard
    // refreshEmailVerified uses after reload.
    await auth.currentUser?.getIdToken(true);
    await deleteMyAccountCallable();
  } catch (e) {
    console.warn("[deleteAccount] callable failed:", e);
    // Nothing was deleted (the callable deletes the auth user first and only
    // returns success once Firestore + Storage are verified clean). The user is
    // still signed in, so drop the takeover and hand the error back to the sheet
    // to retry.
    set({ status: "authenticated" });
    return { success: false, error: "firestore-delete-failed" as const };
  }

  // The `deleting` guard in onAuthStateChanged below skips the usual cleanup,
  // so do it explicitly: tear down the entitlement (profiles/{uid}) listener
  // and drop the RevenueCat identity. Without this the entitlement listener
  // leaks past deletion (firing permission-denied as the token is revoked) and
  // the subscription store keeps showing the deleted account's plan.
  useEntitlementStore.getState().bindUid(null);
  void useSubscriptionStore.getState().setRcUser(null);

  let signOutError: unknown;
  try {
    await firebaseSignOut(auth);
  } catch (err) {
    signOutError = err;
  }

  await clearSignedOutLocalData();

  // Validation: confirm nothing of the user's survives locally before we report
  // success (the cloud side is verified server-side by deleteUserData). The
  // account is already gone, so residue here is logged loudly and re-wiped once
  // rather than surfaced as a failure the user can't act on.
  await assertLocalDataCleared();

  if (signOutError) {
    console.warn("[deleteAccount] firebase sign-out failed:", signOutError);
  }

  set({ status: "signedOut", ...SIGNED_OUT_STATE });

  return { success: true as const };
}

// Post-wipe validation for the delete flow. Re-reads AsyncStorage and the
// in-memory stores that hold user-identifying state; if anything survived, logs
// it and runs one more cleanup pass. Never throws — by the time this runs the
// account is already deleted server-side, so the worst case is a logged warning,
// not a blocked user.
async function assertLocalDataCleared(): Promise<void> {
  const issues = await collectResidualUserData();
  if (issues.length === 0) return;

  console.warn(
    "[deleteAccount] residual user data after wipe, retrying:",
    issues,
  );
  await clearSignedOutLocalData();

  const stillResidual = await collectResidualUserData();
  if (stillResidual.length > 0) {
    console.warn(
      "[deleteAccount] residual user data persists after retry:",
      stillResidual,
    );
  }
}

// Everything user-scoped that should be gone post-wipe: leftover `app.` keys in
// AsyncStorage, plus the in-memory store fields that carry the signed-out user's
// identity/session.
async function collectResidualUserData(): Promise<string[]> {
  const issues: string[] = [];

  const residualKeys = await listResidualUserKeys();
  if (residualKeys.length > 0) {
    issues.push(`asyncStorage[${residualKeys.join(",")}]`);
  }

  if (useChatStore.getState().conversationId) issues.push("chat.conversationId");
  if (useEntitlementStore.getState().uid) issues.push("entitlement.uid");

  const persona = usePersonaStore.getState();
  if (persona.selectedPersonaId !== DEFAULT_PERSONA_ID) {
    issues.push("persona.selectedId");
  }
  if (persona.personas.length > 0) issues.push("persona.list");

  return issues;
}

async function clearSignedOutLocalData(): Promise<void> {
  useChatStore.getState().startNewConversation();
  useEntitlementStore.getState().bindUid(null);
  // Persona selection + hydrated list back to the default (also removes the
  // persisted app.persona.selectedId key), so the next user on this device
  // never inherits the previous user's bot.
  usePersonaStore.getState().clear();

  await Promise.all([
    useSubscriptionStore.getState().setRcUser(null).catch(() => {}),
    wipeLocalAppData().catch(() => {}),
    useOnboardingStore.getState().reset().catch(() => {}),
    useSettingsStore.getState().reset().catch(() => {}),
    useReviewPromptStore.getState().reset().catch(() => {}),
    // Cancel scheduled rot-check notifications carrying the user's bots and drop
    // the in-memory opt-in. OS-level permission is left as-is (device state).
    teardownUserNotifications().catch(() => {}),
  ]);
}
