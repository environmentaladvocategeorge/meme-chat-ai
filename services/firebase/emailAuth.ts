import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updatePassword,
  verifyBeforeUpdateEmail,
} from "firebase/auth";
import { getFirebaseServices } from "./app";

export type RegisterEmailError =
  | "email-already-in-use"
  | "weak-password"
  | "invalid-email"
  | "generic";

export type RegisterEmailResult =
  | { success: true; uid: string; email: string; emailVerified: boolean }
  | { success: false; error: RegisterEmailError };

export type SignInEmailError =
  | "invalid-credential"
  | "invalid-email"
  | "too-many-requests"
  | "generic";

export type SignInEmailResult =
  | { success: true; uid: string; email: string; emailVerified: boolean }
  | { success: false; error: SignInEmailError };

export type PasswordResetError =
  | "invalid-email"
  | "too-many-requests"
  | "generic";

export type PasswordResetResult =
  | { success: true }
  | { success: false; error: PasswordResetError };

export type ResendVerificationResult =
  | { success: true }
  | { success: false; error: "too-many-requests" | "generic" };

export type DeleteAccountError =
  | "invalid-credential"
  | "too-many-requests"
  | "firestore-delete-failed"
  | "apple-cancelled"
  | "apple-unavailable"
  | "apple-user-mismatch"
  | "reauth-failed"
  | "generic";

function getErrorCode(error: unknown): string {
  if (error instanceof Error && "code" in error)
    return (error as { code: string }).code;
  return "";
}

export async function registerWithEmail(
  email: string,
  password: string,
): Promise<RegisterEmailResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return { success: false, error: "generic" };

  const { auth } = firebase.services;

  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);

    // Verification email is best-effort and never blocks the result.
    try {
      await sendEmailVerification(result.user);
    } catch {}

    return {
      success: true,
      uid: result.user.uid,
      email: result.user.email ?? email,
      emailVerified: result.user.emailVerified,
    };
  } catch (error: unknown) {
    const code = getErrorCode(error);
    if (code === "auth/email-already-in-use")
      return { success: false, error: "email-already-in-use" };
    if (code === "auth/weak-password")
      return { success: false, error: "weak-password" };
    if (code === "auth/invalid-email")
      return { success: false, error: "invalid-email" };
    return { success: false, error: "generic" };
  }
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<SignInEmailResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return { success: false, error: "generic" };

  const { auth } = firebase.services;

  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return {
      success: true,
      uid: result.user.uid,
      email: result.user.email ?? email,
      emailVerified: result.user.emailVerified,
    };
  } catch (error: unknown) {
    const code = getErrorCode(error);
    if (
      code === "auth/invalid-credential" ||
      code === "auth/user-not-found" ||
      code === "auth/wrong-password"
    ) {
      return { success: false, error: "invalid-credential" };
    }
    if (code === "auth/invalid-email")
      return { success: false, error: "invalid-email" };
    if (code === "auth/too-many-requests")
      return { success: false, error: "too-many-requests" };
    return { success: false, error: "generic" };
  }
}

export async function sendPasswordReset(
  email: string,
): Promise<PasswordResetResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return { success: false, error: "generic" };

  const { auth } = firebase.services;

  try {
    await sendPasswordResetEmail(auth, email);
    return { success: true };
  } catch (error: unknown) {
    const code = getErrorCode(error);
    // Treat user-not-found as success to avoid leaking which emails are
    // registered.
    if (code === "auth/user-not-found") return { success: true };
    if (code === "auth/invalid-email")
      return { success: false, error: "invalid-email" };
    if (code === "auth/too-many-requests")
      return { success: false, error: "too-many-requests" };
    return { success: false, error: "generic" };
  }
}

export async function reloadEmailVerification(): Promise<boolean> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return false;

  const { auth } = firebase.services;
  const user = auth.currentUser;
  if (!user) return false;

  try {
    await user.reload();
    // Force a new ID token so Cloud Functions see the updated email_verified claim.
    await auth.currentUser?.getIdToken(true);
    return auth.currentUser?.emailVerified ?? false;
  } catch {
    return false;
  }
}

export async function resendVerificationEmail(): Promise<ResendVerificationResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return { success: false, error: "generic" };

  const { auth } = firebase.services;
  const user = auth.currentUser;
  if (!user) return { success: false, error: "generic" };

  try {
    await sendEmailVerification(user);
    return { success: true };
  } catch (error: unknown) {
    const code = getErrorCode(error);
    if (code === "auth/too-many-requests")
      return { success: false, error: "too-many-requests" };
    return { success: false, error: "generic" };
  }
}

export async function reauthenticateWithPassword(
  password: string,
): Promise<{ success: true } | { success: false; error: DeleteAccountError }> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return { success: false, error: "generic" };

  const { auth } = firebase.services;
  const user = auth.currentUser;
  if (!user || !user.email) return { success: false, error: "generic" };

  try {
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
    return { success: true };
  } catch (error: unknown) {
    const code = getErrorCode(error);
    if (code === "auth/invalid-credential" || code === "auth/wrong-password")
      return { success: false, error: "invalid-credential" };
    if (code === "auth/too-many-requests")
      return { success: false, error: "too-many-requests" };
    return { success: false, error: "generic" };
  }
}

export type ChangePasswordError =
  | "invalid-credential"
  | "weak-password"
  | "too-many-requests"
  | "generic";

export type ChangePasswordResult =
  | { success: true }
  | { success: false; error: ChangePasswordError };

export type ChangeEmailError =
  | "invalid-credential"
  | "email-already-in-use"
  | "invalid-email"
  | "too-many-requests"
  | "generic";

export type ChangeEmailResult =
  | { success: true }
  | { success: false; error: ChangeEmailError };

export async function changeUserPassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return { success: false, error: "generic" };

  const { auth } = firebase.services;
  const user = auth.currentUser;
  if (!user || !user.email) return { success: false, error: "generic" };

  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
    return { success: true };
  } catch (error: unknown) {
    const code = getErrorCode(error);
    if (code === "auth/invalid-credential" || code === "auth/wrong-password")
      return { success: false, error: "invalid-credential" };
    if (code === "auth/weak-password")
      return { success: false, error: "weak-password" };
    if (code === "auth/too-many-requests")
      return { success: false, error: "too-many-requests" };
    return { success: false, error: "generic" };
  }
}

// Uses verifyBeforeUpdateEmail rather than updateEmail: the address only
// switches once the user confirms the link sent to the NEW inbox, so a typo
// can never lock them out of their account.
export async function changeUserEmail(
  currentPassword: string,
  newEmail: string,
): Promise<ChangeEmailResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return { success: false, error: "generic" };

  const { auth } = firebase.services;
  const user = auth.currentUser;
  if (!user || !user.email) return { success: false, error: "generic" };

  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await verifyBeforeUpdateEmail(user, newEmail);
    return { success: true };
  } catch (error: unknown) {
    const code = getErrorCode(error);
    if (code === "auth/invalid-credential" || code === "auth/wrong-password")
      return { success: false, error: "invalid-credential" };
    if (code === "auth/email-already-in-use")
      return { success: false, error: "email-already-in-use" };
    if (code === "auth/invalid-email")
      return { success: false, error: "invalid-email" };
    if (code === "auth/too-many-requests")
      return { success: false, error: "too-many-requests" };
    return { success: false, error: "generic" };
  }
}
