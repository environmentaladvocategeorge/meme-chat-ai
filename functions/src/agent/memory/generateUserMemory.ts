import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { calculateCostUsd, calculateCredits } from "../../billing/credits";
import { chargeCredits } from "../../billing/ledger";
import { PLANS, type PlanId } from "../../billing/plans";
import { MemoryService } from "./MemoryService";
import { transcriptTailLimit } from "./extractionWindow";
import { memoryEnabledForUser } from "./gating";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// How many new complete messages must accrue before we re-run extraction. Memory
// is "subconscious" — it doesn't need to update every turn, and gating keeps the
// nano cost negligible. ~6 messages ≈ a few exchanges.
const REFRESH_EVERY_MESSAGES = 6;

// An in-flight extraction holds a claim this long; an older claim is treated as
// dead (crashed/timed-out) so a later write can retry. Mirrors the title job.
const MEMORY_CLAIM_TTL_MS = 60_000;

// Transcript handed to the extractor: only the messages that are NEW since the
// last extraction plus a few context turns — see extractionWindow.ts for the
// window math and the one-off-inflation rationale. Char-capped so a long chat
// can't blow up the nano input.
const MAX_TRANSCRIPT_CHARS = 8000;

const memoryService = new MemoryService();

function attachmentNote(d: { images?: unknown[]; gifs?: unknown[] }): string | null {
  if (Array.isArray(d.images) && d.images.length > 0) return "[sent a meme image]";
  if (Array.isArray(d.gifs) && d.gifs.length > 0) return "[sent an animated GIF]";
  return null;
}

// Background memory builder. Fires on every message write but short-circuits hard
// before any model call: it runs only for paid users, and only once enough new
// messages have accrued. Fully offline (never on the reply path) so it can't
// affect turn latency. Extraction cost is absorbed (not billed), like the
// summarizer.
export const generateUserMemory = onDocumentWritten(
  {
    document: "conversations/{cid}/messages/{mid}",
    secrets: [OPENAI_API_KEY],
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const cid = event.params.cid;
    const db = getFirestore();
    const conversationRef = db.doc(`conversations/${cid}`);

    const convSnap = await conversationRef.get();
    const conv = convSnap.data() as
      | { uid?: string; memoryMsgCount?: number; memoryClaimedAt?: Timestamp }
      | undefined;
    const uid = conv?.uid;
    if (!uid) return;

    // Authoritative plan = the user's CURRENT profile plan (the conversation doc
    // doesn't reliably carry plan). Free users are never extracted.
    const profileSnap = await db.doc(`profiles/${uid}`).get();
    const planRaw = profileSnap.data()?.plan;
    const plan: PlanId =
      typeof planRaw === "string" && planRaw in PLANS ? (planRaw as PlanId) : "free";
    if (!memoryEnabledForUser(uid, plan)) return;

    // Respect the user's on/off switch before doing any work (cheap doc read).
    if (!(await memoryService.isEnabled(uid))) return;

    // Cheap aggregation gate: only proceed once enough new messages have landed
    // since the last refresh. Avoids running extraction on every single write.
    const countSnap = await conversationRef.collection("messages").count().get();
    const total = countSnap.data().count;
    const lastCount = conv.memoryMsgCount ?? 0;
    if (total - lastCount < REFRESH_EVERY_MESSAGES) return;

    // Atomic claim so only one invocation runs extraction for this conversation
    // at a time; stale claims age out (TTL) so a crashed attempt can retry.
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(conversationRef);
      const d = snap.data() as
        | { memoryMsgCount?: number; memoryClaimedAt?: Timestamp }
        | undefined;
      if (!d) return false;
      const claim = d.memoryClaimedAt;
      const live =
        claim instanceof Timestamp &&
        Date.now() - claim.toMillis() < MEMORY_CLAIM_TTL_MS;
      if (live) return false;
      tx.update(conversationRef, { memoryClaimedAt: Timestamp.now() });
      return true;
    });
    if (!claimed) return;

    try {
      // Build the NEW-tail transcript (oldest → newest), complete turns only:
      // the messages since the last extraction plus a few context turns.
      const recentSnap = await conversationRef
        .collection("messages")
        .orderBy("createdAt", "desc")
        .limit(transcriptTailLimit(total, lastCount))
        .get();

      const lines: string[] = [];
      for (const doc of recentSnap.docs.slice().reverse()) {
        const d = doc.data() as {
          role?: string;
          text?: string;
          status?: string;
          images?: unknown[];
          gifs?: unknown[];
        };
        if (d.status !== "complete") continue;
        const text = typeof d.text === "string" ? d.text.trim() : "";
        const note = attachmentNote(d);
        const body = [text, note].filter(Boolean).join(" ");
        if (!body) continue;
        lines.push(`${d.role === "agent" ? "Brainrot Bot" : "User"}: ${body}`);
      }

      let transcript = lines.join("\n");
      if (transcript.length > MAX_TRANSCRIPT_CHARS) {
        transcript = transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS);
      }
      if (!transcript.trim()) return;

      const result = await memoryService.refreshFromConversation({
        uid,
        plan,
        conversationId: cid,
        transcript,
        apiKey: OPENAI_API_KEY.value(),
      });

      // Record the watermark so the gate measures new messages from here, and
      // release the claim. Done even when nothing changed so we don't re-extract
      // the same tail every 6 messages with no new signal.
      await conversationRef.set(
        { memoryMsgCount: total, memoryClaimedAt: FieldValue.delete() },
        { merge: true },
      );

      // Bill the extraction's nano usage to the user — it counts toward their
      // token budget, recorded as a "memory" usage event (mirrors how titles are
      // billed). Charged whenever the model actually ran, even if it produced no
      // new facts (the tokens were still spent). Best-effort: a billing failure
      // must not fail the refresh.
      const u = result.usage;
      if (u && (u.inputTokens > 0 || u.outputTokens > 0)) {
        const costUsd = calculateCostUsd(u.model, u);
        await chargeCredits(uid, plan, {
          conversationId: cid,
          messageId: null,
          kind: "memory",
          usages: [u],
          costUsd,
          credits: calculateCredits(costUsd),
        }).catch((err) =>
          logger.error("[generateUserMemory] memory charge failed", { cid, err }),
        );
      }

      logger.info("[generateUserMemory] refreshed", {
        cid,
        plan,
        changed: result.changed,
        factCount: result.factCount,
      });
    } catch (err) {
      logger.error("[generateUserMemory] failed", { cid, err });
      // Release the claim so a later write can retry.
      await conversationRef
        .set({ memoryClaimedAt: FieldValue.delete() }, { merge: true })
        .catch(() => undefined);
    }
  },
);
