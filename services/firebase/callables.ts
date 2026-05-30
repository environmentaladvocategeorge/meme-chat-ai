import { httpsCallable } from "firebase/functions";
import { type PlanId } from "@/domain/billing";
import {
  type ContentFilter,
  type TrendingMemesResult,
} from "@/domain/memes";
import { type TrendingGifsResult } from "@/domain/gifs";
import { getFirebaseServices } from "./app";

export async function deleteMyAccountCallable(): Promise<{ success: true }> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<void, { success: true }>(
    firebase.services.functions,
    "deleteMyAccount",
  );
  const result = await callable();
  return result.data;
}

// Permanently deletes the given conversations (server-side, Admin SDK). The
// quota ledger is deliberately untouched — see deleteConversations.ts.
export async function deleteConversationsCallable(
  conversationIds: string[],
): Promise<{ success: true; deleted: number }> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<
    { conversationIds: string[] },
    { success: true; deleted: number }
  >(firebase.services.functions, "deleteConversations");
  const result = await callable({ conversationIds });
  return result.data;
}

// Best-effort optimistic plan sync after RevenueCat's CustomerInfoUpdate
// fires. Server downgrades will be applied by the RC webhook regardless of
// what we POST here — see functions/src/revenueCat/syncPlan.ts.
export async function syncRevenueCatPlanCallable(args: {
  activeProductId: string | null;
}): Promise<{ plan: PlanId }> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<
    { activeProductId: string | null },
    { plan: PlanId }
  >(firebase.services.functions, "syncRevenueCatPlan");
  const result = await callable(args);
  return result.data;
}

// Persists onboarding personalization to profiles/{uid} (Admin SDK, server-
// side — client writes to profiles are blocked by firestore.rules) and stamps
// the profile complete. Best-effort: callers should not block onboarding on a
// failure here, since the local copy + onboarding flag already advance the user.
export async function updateProfileCallable(args: {
  alias?: string;
  displayName?: string;
  onboardingCompleted?: boolean;
}): Promise<{
  success: true;
  alias: string | null;
  displayName: string | null;
  onboardingCompleted: boolean;
}> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<
    { alias?: string; displayName?: string; onboardingCompleted?: boolean },
    {
      success: true;
      alias: string | null;
      displayName: string | null;
      onboardingCompleted: boolean;
    }
  >(firebase.services.functions, "updateProfile");
  const result = await callable(args);
  return result.data;
}

export type MessageReaction = "up" | "down";

// Records (or clears, when reaction is null) the caller's thumbs rating on a
// message. Client writes to messages are blocked by firestore.rules, so this
// goes through the Admin SDK callable.
export async function rateMessageCallable(args: {
  conversationId: string;
  messageId: string;
  reaction: MessageReaction | null;
}): Promise<{ success: true; reaction: MessageReaction | null }> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<
    {
      conversationId: string;
      messageId: string;
      reaction: MessageReaction | null;
    },
    { success: true; reaction: MessageReaction | null }
  >(firebase.services.functions, "rateMessage");
  const result = await callable(args);
  return result.data;
}

export type TrendingMemesParams = {
  page?: number;
  perPage?: number;
  // ISO 3166-1 alpha-2 country code, e.g. "us".
  locale?: string;
  contentFilter?: ContentFilter;
};

// Fetches a page of trending memes from Klipy via the backend (which holds the
// app key and passes the signed-in user's uid as a stable customer_id).
export async function getTrendingMemesCallable(
  params: TrendingMemesParams = {},
): Promise<TrendingMemesResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<TrendingMemesParams, TrendingMemesResult>(
    firebase.services.functions,
    "getTrendingMemes",
  );
  const result = await callable(params);
  return result.data;
}

export type SearchMemesParams = TrendingMemesParams & {
  // The search keyword. per_page minimum is 8 for search (Klipy bound).
  query: string;
};

// Searches Klipy memes by keyword via the backend. Same normalized result
// shape + pagination as trending.
export async function searchMemesCallable(
  params: SearchMemesParams,
): Promise<TrendingMemesResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<SearchMemesParams, TrendingMemesResult>(
    firebase.services.functions,
    "searchMemes",
  );
  const result = await callable(params);
  return result.data;
}

export type TrendingGifsParams = TrendingMemesParams;
export type SearchGifsParams = SearchMemesParams;

// Fetches a page of trending GIFs from Klipy via the backend. Mirrors
// getTrendingMemesCallable; the backend holds the (shared) app key.
export async function getTrendingGifsCallable(
  params: TrendingGifsParams = {},
): Promise<TrendingGifsResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<TrendingGifsParams, TrendingGifsResult>(
    firebase.services.functions,
    "getTrendingGifs",
  );
  const result = await callable(params);
  return result.data;
}

// Searches Klipy GIFs by keyword via the backend.
export async function searchGifsCallable(
  params: SearchGifsParams,
): Promise<TrendingGifsResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<SearchGifsParams, TrendingGifsResult>(
    firebase.services.functions,
    "searchGifs",
  );
  const result = await callable(params);
  return result.data;
}

export type WatermarkResult = {
  // Base64-encoded PNG (KLIPY watermark composited) to decode + save.
  dataBase64: string;
  mimeType: "image/png";
};

// Returns a watermarked PNG (base64) for a KLIPY asset url, so a downloaded
// chat attachment carries the required KLIPY attribution. GIFs pass their still
// poster url — downloads are a static watermarked frame by design.
export async function watermarkAttachmentCallable(
  url: string,
): Promise<WatermarkResult> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<{ url: string }, WatermarkResult>(
    firebase.services.functions,
    "watermarkAttachment",
  );
  const result = await callable({ url });
  return result.data;
}
