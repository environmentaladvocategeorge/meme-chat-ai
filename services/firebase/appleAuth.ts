import { randomNonce, sha256 } from "@/domain/appleNonce";
import * as AppleAuthentication from "expo-apple-authentication";
import { FirebaseError } from "firebase/app";
import {
  OAuthProvider,
  reauthenticateWithCredential,
  signInWithCredential,
} from "firebase/auth";
import { getFirebaseServices } from "./app";

export type AppleAuthProviderInfo = {
  providerId: string;
  email?: string | null;
};

export type SignInAppleError =
  | "cancelled"
  | "account-exists-with-different-credential"
  | "operation-not-allowed"
  | "network-request-failed"
  | "missing-identity-token"
  | "unavailable"
  | "generic";

export type SignInAppleResult =
  | {
      success: true;
      uid: string;
      email: string | null;
      emailVerified: boolean;
      providers: AppleAuthProviderInfo[];
    }
  | { success: false; error: SignInAppleError };

function getErrorCode(error: unknown) {
  if (error instanceof FirebaseError) return error.code;

  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }

  return "unknown";
}

function mapAppleAuthError(error: unknown): SignInAppleError {
  const code = getErrorCode(error);

  if (code === "ERR_REQUEST_CANCELED") return "cancelled";
  if (code === "auth/account-exists-with-different-credential") {
    return "account-exists-with-different-credential";
  }
  if (code === "auth/operation-not-allowed") return "operation-not-allowed";
  if (code === "auth/network-request-failed") return "network-request-failed";

  return "generic";
}

export type ReauthenticateAppleError =
  | "cancelled"
  | "missing-identity-token"
  | "unavailable"
  | "no-user"
  | "user-mismatch"
  | "network-request-failed"
  | "generic";

export type ReauthenticateAppleResult =
  | { success: true }
  | { success: false; error: ReauthenticateAppleError };

function mapReauthAppleError(error: unknown): ReauthenticateAppleError {
  const code = getErrorCode(error);

  if (code === "ERR_REQUEST_CANCELED") return "cancelled";
  if (code === "auth/user-mismatch") return "user-mismatch";
  if (code === "auth/network-request-failed") return "network-request-failed";

  return "generic";
}

export async function reauthenticateWithApple(): Promise<ReauthenticateAppleResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return { success: false, error: "unavailable" };

  const user = firebase.services.auth.currentUser;
  if (!user) return { success: false, error: "no-user" };

  try {
    const rawNonce = await randomNonce();
    const hashedNonce = await sha256(rawNonce);

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!appleCredential.identityToken) {
      return { success: false, error: "missing-identity-token" };
    }

    const provider = new OAuthProvider("apple.com");
    const firebaseCredential = provider.credential({
      idToken: appleCredential.identityToken,
      rawNonce,
    });

    await reauthenticateWithCredential(user, firebaseCredential);

    return { success: true };
  } catch (error) {
    return { success: false, error: mapReauthAppleError(error) };
  }
}

export async function signInWithApple(): Promise<SignInAppleResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return { success: false, error: "unavailable" };

  try {
    const rawNonce = await randomNonce();
    const hashedNonce = await sha256(rawNonce);

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!appleCredential.identityToken) {
      return { success: false, error: "missing-identity-token" };
    }

    const provider = new OAuthProvider("apple.com");

    const firebaseCredential = provider.credential({
      idToken: appleCredential.identityToken,
      rawNonce,
    });

    const { user } = await signInWithCredential(
      firebase.services.auth,
      firebaseCredential,
    );

    return {
      success: true,
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      providers: user.providerData.map((providerData) => ({
        providerId: providerData.providerId,
        email: providerData.email,
      })),
    };
  } catch (error) {
    return { success: false, error: mapAppleAuthError(error) };
  }
}
