// PaymentGateway adapter interface — Agent 5, Steps 19-20 (base only).
// No real gateway calls here. Sandbox implementation in Step 20 must implement
// this interface per provider, with signature verification + idempotency on every callback.
import type { Idempotency, ProviderConfig, WebhookVerification } from "./types";

export type PaymentMethod =
  | "cod"
  | "bkash"
  | "nagad"
  | "rocket"
  | "upay"
  | "sslcommerz"
  | "aamarpay"
  | "shurjopay"
  | "stripe"
  | "paypal"
  | "manual_mobile_banking";

export type PaymentStatus =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "FAILED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

/** Covers all methods Nazmul asked for. Stripe/PayPal are optional, international only. */
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "cod",
  "bkash",
  "nagad",
  "rocket",
  "upay",
  "sslcommerz",
  "aamarpay",
  "shurjopay",
  "stripe",
  "paypal",
  "manual_mobile_banking",
];

export interface PaymentInitiateInput extends Idempotency {
  orderId: string;
  /** Integer poisha, never float. */
  amountPoisha: number;
  customerPhone: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface PaymentInitiateResult {
  paymentAttemptId: string;
  /** Redirect URL for hosted gateways; null for COD / manual. */
  redirectUrl: string | null;
  gatewayTransactionId: string | null;
  status: PaymentStatus;
}

export interface PaymentVerifyInput extends Idempotency {
  paymentAttemptId: string;
  gatewayTransactionId: string;
}

export interface PaymentVerifyResult {
  status: PaymentStatus;
  /** Integer poisha actually received. */
  paidPoisha: number;
}

export interface PaymentRefundInput extends Idempotency {
  paymentId: string;
  /** Integer poisha. Partial refunds allowed; total refunded must never exceed paid. */
  amountPoisha: number;
  reason: string;
}

/** Manual mobile-banking payment: customer submits TrxID + sender number, admin approves/rejects. */
export interface ManualTrxSubmission {
  id: string;
  orderId: string;
  method: "bkash" | "nagad" | "rocket" | "upay";
  trxId: string;
  senderPhone: string;
  /** Integer poisha claimed by the customer. */
  amountPoisha: number;
  status: "pending" | "approved" | "rejected";
  reviewedById: string | null;
  reviewNote: string | null;
  submittedAt: string;
  /**
   * Linked Payment parent when this submission's money is carried by
   * a PaymentAttempt (Rocket — src/payments/rocket-manual.ts creates
   * the pair). Null for the classic submission-only flow (bKash /
   * Nagad manual): there the APPROVED submission row itself is the
   * money fact. Money-math aggregates count a LINKED submission via
   * its Payment only, never both (see orders/repository.ts).
   */
  paymentId: string | null;
}

/** Duplicate TrxID detection rule: same (method, trxId) must never approve twice. */
export interface DuplicateTrxCheck {
  method: ManualTrxSubmission["method"];
  trxId: string;
  existingSubmissionId: string | null;
  isDuplicate: boolean;
}

export interface PaymentGateway {
  readonly method: PaymentMethod;
  readonly config: ProviderConfig;
  /** COD returns a non-redirect result; hosted gateways return redirectUrl. */
  initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult>;
  verify(input: PaymentVerifyInput): Promise<PaymentVerifyResult>;
  refund(input: PaymentRefundInput): Promise<{ status: PaymentStatus; refundedPoisha: number }>;
  /** Verify signature, then apply idempotently. Return false for unverified payloads. */
  handleWebhook(verification: WebhookVerification): Promise<boolean>;
}

/** Per-method admin settings: on/off, min/max, fee, sandbox/live. Fee is integer poisha or basis points, never float money. */
export interface PaymentMethodSettings {
  method: PaymentMethod;
  enabled: boolean;
  mode: "sandbox" | "live";
  minAmountPoisha: number | null;
  maxAmountPoisha: number | null;
  /** Flat fee in poisha, 0 = none. Percentage fees are a separate, explicit field in Step 20. */
  flatFeePoisha: number;
  requiresAdvance: boolean;
  credentialRef: string | null;
}
