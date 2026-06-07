// Subset of the RevenueCat webhook payload we actually use. Full spec:
// https://www.revenuecat.com/docs/webhooks
export type RcEventType =
  | "INITIAL_PURCHASE"
  | "RENEWAL"
  | "PRODUCT_CHANGE"
  | "NON_RENEWING_PURCHASE"
  | "CANCELLATION"
  | "EXPIRATION"
  | "BILLING_ISSUE"
  | "SUBSCRIBER_ALIAS"
  | "TRANSFER"
  | "TEST";

export type RcEvent = {
  // RC event identifier — used for idempotent dedup.
  id: string;
  type: RcEventType;
  app_user_id: string;
  original_app_user_id?: string;
  aliases?: string[];
  // Active product at the time of the event (the one purchased/changed/cancelled).
  product_id?: string;
  // ms epoch — when the entitlement expires (RENEWAL/PURCHASE).
  expiration_at_ms?: number;
  // Optional: RC marks events on sandbox keys.
  environment?: "SANDBOX" | "PRODUCTION";
  // For PRODUCT_CHANGE: the new product after the change.
  new_product_id?: string;
  // "TRIAL" on INITIAL_PURCHASE events that start a free trial period.
  // "NORMAL" for standard paid purchases. "INTRO" for paid intro offer periods.
  period_type?: "TRIAL" | "INTRO" | "NORMAL";
  // True on RENEWAL events where the trial just converted to a paid subscription.
  is_trial_conversion?: boolean;
};

export type RcWebhookPayload = {
  event: RcEvent;
  api_version?: string;
};
