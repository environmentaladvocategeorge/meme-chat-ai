import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { createHash } from "crypto";

const REQUESTS_PER_HOUR = 60;
const WINDOW_MS = 60 * 60 * 1000;

function ipKey(ip: string): string {
  // Hash so we never persist raw client IPs in Firestore.
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

export function extractClientIp(headers: {
  forwarded?: string | undefined;
  realIp?: string | undefined;
  fallback?: string | undefined;
}): string | null {
  // x-forwarded-for is a comma-separated list — leftmost is original client.
  const forwarded = headers.forwarded?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  if (headers.realIp) return headers.realIp;
  if (headers.fallback) return headers.fallback;
  return null;
}

// Cheap per-IP rate limit backed by Firestore. Adds one read + one write per
// streamAgentAnswer call. Returns true if the request is allowed, false if
// the IP has burned through REQUESTS_PER_HOUR in the current hour window.
export async function checkIpRateLimit(ip: string | null): Promise<boolean> {
  // Local-only escape hatch. FUNCTIONS_EMULATOR is set to "true" exclusively by
  // the Firebase emulator and is never present in deployed environments
  // (staging/prod), so this fails open during local dev — where every request
  // shares one localhost IP and rapid iteration would otherwise trip the
  // 60/hour cap — without weakening the limit anywhere we deploy.
  if (process.env.FUNCTIONS_EMULATOR === "true") return true;

  if (!ip) return true; // can't enforce without an IP — fail open for emulator/internal calls

  const hourBucket = Math.floor(Date.now() / WINDOW_MS);
  const docId = `${ipKey(ip)}_${hourBucket}`;
  const db = getFirestore();
  const ref = db.doc(`rateLimits/${docId}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.data()?.count as number | undefined) ?? 0;
    if (count >= REQUESTS_PER_HOUR) return false;

    tx.set(
      ref,
      {
        count: FieldValue.increment(1),
        // expireAt lets a TTL policy on rateLimits sweep stale buckets.
        expireAt: Timestamp.fromMillis((hourBucket + 2) * WINDOW_MS),
      },
      { merge: true },
    );
    return true;
  });
}
