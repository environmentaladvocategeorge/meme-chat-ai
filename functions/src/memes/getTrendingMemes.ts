import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  fetchTrendingMemes,
  KlipyError,
  searchMemes as klipySearchMemes,
} from "./klipy";
import { CONTENT_FILTERS, type TrendingMemesResult } from "./types";

// The unique app key issued by KLIPY. Used as a path segment on every request.
const KLIPY_APP_KEY = defineSecret("KLIPY_APP_KEY");

// The Firebase callable wire protocol encodes client-side `undefined` as
// `null`, so optional fields land here as `null` rather than absent. Drop
// top-level nulls back to absent keys so zod's `.optional()` / `.default()`
// apply as intended instead of failing the `null` against a string/number.
function stripNulls(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value !== null) out[key] = value;
  }
  return out;
}

// ISO 3166-1 alpha-2 country code, e.g. "us". Lowercased, 2 letters.
const localeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/)
  .optional();
const contentFilterSchema = z.enum(CONTENT_FILTERS).optional();

// Trending bounds: per_page 1..50 (default 24), page >= 1 (default 1).
const trendingSchema = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(50).default(24),
  locale: localeSchema,
  contentFilter: contentFilterSchema,
});

// Search bounds per Klipy docs: per_page 8..50 (default 24), q required.
const searchSchema = z.object({
  query: z.string().trim().min(1).max(100),
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(8).max(50).default(24),
  locale: localeSchema,
  contentFilter: contentFilterSchema,
});

// Shared auth + config gate. Throws the appropriate HttpsError and narrows the
// uid to a string for callers.
function requireAccess(uid: string | undefined, apiKey: string): string {
  if (!uid) {
    throw new HttpsError("unauthenticated", "auth-required");
  }
  if (!apiKey) {
    logger.error("[memes] rejected: KLIPY_APP_KEY not configured");
    throw new HttpsError("failed-precondition", "klipy-not-configured");
  }
  return uid;
}

// Runs a Klipy fetch and maps its failures to clean HttpsErrors + logs.
async function runFetch(
  label: string,
  fn: () => Promise<TrendingMemesResult>,
): Promise<TrendingMemesResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof KlipyError) {
      logger.error(`[${label}] klipy error`, {
        status: err.status,
        message: err.message,
      });
      throw new HttpsError("unavailable", "klipy-unavailable");
    }
    logger.error(`[${label}] unexpected error`, { err });
    throw new HttpsError("internal", "internal");
  }
}

export async function getTrendingMemesImpl(
  uid: string | undefined,
  apiKey: string,
  data: unknown,
): Promise<TrendingMemesResult> {
  const customerId = requireAccess(uid, apiKey);

  const parsed = trendingSchema.safeParse(stripNulls(data ?? {}));
  if (!parsed.success) {
    logger.warn("[getTrendingMemes] rejected: invalid request", {
      issues: parsed.error.issues,
    });
    throw new HttpsError("invalid-argument", "invalid-request");
  }

  const { page, perPage, locale, contentFilter } = parsed.data;
  return runFetch("getTrendingMemes", () =>
    fetchTrendingMemes({
      apiKey,
      page,
      perPage,
      // Stable per-user id for Klipy personalization. Never the raw account
      // email — the Firebase uid is opaque and consistent.
      customerId,
      locale,
      // Default to a conservative safety level for a consumer chat app.
      contentFilter: contentFilter ?? "medium",
    }),
  );
}

export async function searchMemesImpl(
  uid: string | undefined,
  apiKey: string,
  data: unknown,
): Promise<TrendingMemesResult> {
  const customerId = requireAccess(uid, apiKey);

  const parsed = searchSchema.safeParse(stripNulls(data ?? {}));
  if (!parsed.success) {
    logger.warn("[searchMemes] rejected: invalid request", {
      issues: parsed.error.issues,
    });
    throw new HttpsError("invalid-argument", "invalid-request");
  }

  const { query, page, perPage, locale, contentFilter } = parsed.data;
  return runFetch("searchMemes", () =>
    klipySearchMemes({
      apiKey,
      query,
      page,
      perPage,
      customerId,
      locale,
      contentFilter: contentFilter ?? "medium",
    }),
  );
}

const callableOptions = {
  secrets: [KLIPY_APP_KEY],
  region: "us-central1" as const,
  timeoutSeconds: 30,
  memory: "256MiB" as const,
};

export const getTrendingMemes = onCall(callableOptions, async (req) => {
  return getTrendingMemesImpl(req.auth?.uid, KLIPY_APP_KEY.value(), req.data);
});

export const searchMemes = onCall(callableOptions, async (req) => {
  return searchMemesImpl(req.auth?.uid, KLIPY_APP_KEY.value(), req.data);
});
