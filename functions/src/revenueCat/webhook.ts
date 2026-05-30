import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { readProfileBilling } from "../entitlement/schema";
import { handleRcEvent, isSandboxEvent } from "./handle";
import type { RcEvent, RcWebhookPayload } from "./types";

const REVENUECAT_WEBHOOK_AUTH = defineSecret("REVENUECAT_WEBHOOK_AUTH");

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function sandboxAllowed() {
  return process.env.ALLOW_RC_SANDBOX === "true";
}

function isRcEvent(value: unknown): value is RcEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.type === "string" &&
    typeof v.app_user_id === "string"
  );
}

export const revenueCatWebhook = onRequest(
  {
    secrets: [REVENUECAT_WEBHOOK_AUTH],
    region: "us-central1",
    cors: false,
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).end();
      return;
    }

    const expected = REVENUECAT_WEBHOOK_AUTH.value();
    const provided = req.header("authorization") ?? "";
    if (!expected || provided !== expected) {
      logger.warn("[rc-webhook] unauthorized");
      res.status(401).end();
      return;
    }

    const payload = req.body as RcWebhookPayload | undefined;
    if (!payload || !isRcEvent(payload.event)) {
      res.status(400).json({ code: "invalid-payload" });
      return;
    }

    const event = payload.event;

    if (isProduction() && isSandboxEvent(event) && !sandboxAllowed()) {
      logger.info("[rc-webhook] sandbox event skipped", {
        rcEventId: event.id,
        type: event.type,
      });
      // Still ACK so RC doesn't retry forever.
      res.status(200).json({ skipped: "sandbox" });
      return;
    }

    const db = getFirestore();
    const dedupRef = db.doc(`revenueCatEvents/${event.id}`);
    const uid = event.app_user_id;
    const profileRef = db.doc(`profiles/${uid}`);

    try {
      const outcome = await db.runTransaction(async (tx) => {
        const dedupSnap = await tx.get(dedupRef);
        if (dedupSnap.exists) {
          return { duplicate: true } as const;
        }

        const profileSnap = await tx.get(profileRef);
        const current = profileSnap.exists
          ? readProfileBilling(profileSnap.data())
          : null;

        const decision = handleRcEvent(current, event, new Date());

        tx.set(dedupRef, {
          uid,
          type: event.type,
          productId: event.new_product_id ?? event.product_id ?? null,
          isSandbox: isSandboxEvent(event),
          processedAt: FieldValue.serverTimestamp(),
          // Store a compact echo for audit; do NOT store secrets.
          raw: {
            id: event.id,
            type: event.type,
            app_user_id: event.app_user_id,
            product_id: event.product_id ?? null,
            new_product_id: event.new_product_id ?? null,
            expiration_at_ms: event.expiration_at_ms ?? null,
            environment: event.environment ?? null,
          },
        });

        if (decision.kind === "apply") {
          tx.set(profileRef, decision.next, { merge: true });
          return { duplicate: false, applied: true, plan: decision.next.plan } as const;
        }

        return { duplicate: false, applied: false, reason: decision.reason } as const;
      });

      logger.info("[rc-webhook] processed", {
        rcEventId: event.id,
        uid,
        type: event.type,
        ...outcome,
      });
      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error("[rc-webhook] failed", { rcEventId: event.id, err });
      res.status(500).json({ code: "internal" });
    }
  },
);
