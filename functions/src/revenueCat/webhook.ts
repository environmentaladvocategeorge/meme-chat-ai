import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
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

export async function processRevenueCatEvent(
  db: Firestore,
  event: RcEvent,
): Promise<
  | { duplicate: true }
  | { duplicate: false; applied: true; plan: string }
  | { duplicate: false; applied: false; reason: string }
> {
  const dedupRef = db.doc(`revenueCatEvents/${event.id}`);
  const profileRef = db.doc(`profiles/${event.app_user_id}`);

  return db.runTransaction(async (tx) => {
    const dedupSnap = await tx.get(dedupRef);
    if (dedupSnap.exists) {
      return { duplicate: true } as const;
    }

    const profileSnap = await tx.get(profileRef);
    if (!profileSnap.exists) {
      tx.set(dedupRef, {
        type: event.type,
        productId: event.new_product_id ?? event.product_id ?? null,
        isSandbox: isSandboxEvent(event),
        processedAt: FieldValue.serverTimestamp(),
        applied: false,
        reason: "missing-profile",
        raw: {
          id: event.id,
          type: event.type,
          product_id: event.product_id ?? null,
          new_product_id: event.new_product_id ?? null,
          expiration_at_ms: event.expiration_at_ms ?? null,
          environment: event.environment ?? null,
        },
      });
      return {
        duplicate: false,
        applied: false,
        reason: "missing-profile",
      } as const;
    }

    const current = readProfileBilling(profileSnap.data());
    const decision = handleRcEvent(current, event, new Date());

    tx.set(dedupRef, {
      type: event.type,
      productId: event.new_product_id ?? event.product_id ?? null,
      isSandbox: isSandboxEvent(event),
      processedAt: FieldValue.serverTimestamp(),
      applied: decision.kind === "apply",
      raw: {
        id: event.id,
        type: event.type,
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

    try {
      const outcome = await processRevenueCatEvent(getFirestore(), event);

      logger.info("[rc-webhook] processed", {
        rcEventId: event.id,
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
