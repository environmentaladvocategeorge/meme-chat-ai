import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { MemoryService } from "./MemoryService";

const memoryService = new MemoryService();

// Flips the caller's memory on/off switch. Memory state is server-written only
// (firestore.rules), so the toggle goes through this callable. The hot path
// (injection) and cold path (extraction) both read `enabled` and skip when off.
export const setMemoryEnabled = onCall({ region: "us-central1" }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

  const enabled = req.data?.enabled;
  if (typeof enabled !== "boolean") {
    throw new HttpsError("invalid-argument", "invalid-enabled");
  }

  try {
    await memoryService.setEnabled(uid, enabled);
  } catch (err) {
    logger.error("[setMemoryEnabled] failed", { err });
    throw new HttpsError("internal", "set-failed");
  }

  return { success: true as const, enabled };
});
