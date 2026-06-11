import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";

// Codes verifyIdToken throws when the TOKEN ITSELF is rejected — expired,
// revoked, malformed, or its user gone/disabled. These are genuine 401s the
// client may treat as "session dead" (it signs the user out on them after one
// forced-refresh replay). Anything else — auth/internal-error, a network
// failure reaching the Auth backend on the checkRevoked lookup — says nothing
// about the token, so it must NOT 401: the client would misread a healthy
// session as expired and log the user out.
const TOKEN_REJECTION_CODES = new Set([
  "auth/argument-error",
  "auth/invalid-id-token",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/user-disabled",
  "auth/user-not-found",
]);

function getErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

export function getBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

// Verifies the request's bearer token (revocation-checked) and returns the
// uid, or writes the error response and returns null.
//
// Our 401s always carry a JSON body whose `code` starts with "auth/" — that
// marker is how the client tells an auth rejection minted HERE apart from an
// infrastructure 401 (e.g. Google Frontend after a redeploy drops the Cloud
// Run invoker binding, which rejects requests before this code ever runs).
// The client only ends the local session on a marked 401.
export async function authenticateStreamRequest(
  req: Request,
  res: Response,
  label: string,
): Promise<string | null> {
  const token = getBearerToken(req.header("authorization"));
  if (!token) {
    res.status(401).json({ code: "missing-token" });
    return null;
  }

  try {
    const decoded = await getAuth().verifyIdToken(token, true);
    return decoded.uid;
  } catch (err) {
    const code = getErrorCode(err);
    if (code && TOKEN_REJECTION_CODES.has(code)) {
      logger.warn(`[${label}] auth token rejected`, { code });
      res.status(401).json({ code });
      return null;
    }
    // The verification itself failed (not the token): answer 503 so the
    // client surfaces a retryable error instead of a sign-out.
    logger.error(`[${label}] auth verification unavailable`, { err });
    res.status(503).json({ code: "auth-unavailable" });
    return null;
  }
}
