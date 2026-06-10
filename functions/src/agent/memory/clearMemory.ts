import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { MemoryService } from "./MemoryService";

const memoryService = new MemoryService();

// Lets a signed-in user clear their own memory. The user can SEE memory (reads
// the facts subcollection directly under firestore.rules) and CLEAR it (here),
// but never EDIT it — there is no create/update path for clients anywhere.
//
//   data: { factId: string }  -> delete that one fact and recompile the block
//   data: {}                  -> clear ALL memory
export const clearMemory = onCall({ region: "us-central1" }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

  const factId = req.data?.factId;
  if (factId !== undefined && typeof factId !== "string") {
    throw new HttpsError("invalid-argument", "invalid-factId");
  }

  try {
    if (typeof factId === "string" && factId.trim().length > 0) {
      await memoryService.deleteFact(uid, factId.trim());
      logger.info("[clearMemory] deleted one fact", { scope: "fact" });
    } else {
      await memoryService.clearAll(uid);
      logger.info("[clearMemory] cleared all memory", { scope: "all" });
    }
  } catch (err) {
    logger.error("[clearMemory] failed", { err });
    throw new HttpsError("internal", "clear-failed");
  }

  return { success: true as const };
});
