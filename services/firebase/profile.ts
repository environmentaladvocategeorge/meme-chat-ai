import { doc, getDoc } from "firebase/firestore";
import { getFirebaseServices } from "./app";

// How long the sign-in path is willing to wait on the profile read before
// giving up. Failing closed (false) just means the user re-onboards — the
// pre-existing behavior — so a slow network must never stall sign-in.
const FETCH_TIMEOUT_MS = 5000;

// Reads the durable onboarding marker off profiles/{uid}. The updateProfile
// callable stamps `onboardingCompleted: true` there when the flow finishes;
// unlike the device-local flag (wiped on every sign-out, lost on reinstall)
// the profile copy survives, so it's the truth for "has this ACCOUNT
// onboarded". Any failure — offline, permission-denied (unverified email),
// timeout — reads as false: worst case the user sees onboarding again,
// which is exactly what happened before this check existed.
export async function fetchOnboardingCompleted(uid: string): Promise<boolean> {
  const firebase = getFirebaseServices();
  if (!firebase.available) return false;

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    // The read swallows its own rejection so a getDoc that fails AFTER the
    // timeout already won the race can't surface as an unhandled rejection.
    const read = getDoc(doc(firebase.services.firestore, "profiles", uid))
      .then((snap) => snap.data()?.onboardingCompleted === true)
      .catch(() => false);
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), FETCH_TIMEOUT_MS);
    });
    return await Promise.race([read, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
