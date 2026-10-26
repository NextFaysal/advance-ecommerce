// BullMQ queue contracts — Step 17/22/26/31 jobs.
// Slow/external work must go through these queues, never block a request.
// This file defines queue names, job payload types, and retry policy only.
// Workers that call real SMS/email/courier/payment APIs are implemented in
// the jobs worker process ( separate deployment ), using the adapters in
// src/integrations. Payloads must never contain a secret or a full phone
// number in plain text in logs — use masked refs / ids only.

export const QUEUE_NAMES = {
  sms: "sms-send",
  email: "email-send",
  courierBooking: "courier-booking",
  courierSync: "courier-status-sync",
  webhook: "webhook-delivery",
  importExport: "import-export",
  report: "report-generation",
  notificationRetry: "notification-retry",
  abandonedCart: "abandoned-cart-followup",
  automation: "automation-run",
  bulkActions: "bulk-actions",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface JobRetryPolicy {
  attempts: number;
  backoffSeconds: number;
}

export const DEFAULT_RETRY: JobRetryPolicy = { attempts: 3, backoffSeconds: 30 };
export const COURIER_RETRY: JobRetryPolicy = { attempts: 5, backoffSeconds: 60 };

export interface SmsJob {
  orderId?: string;
  templateKey: string;
  recipientRef: string;
  /**
   * C4 call-center automation jobs ride this same queue + payload
   * (jobKind === "callcenter-automation"); the SMS handler delegates
   * them to the automation send path (HandlerDeps.callCenterSmsSend).
   * The payload carries ids only — the recipient phone is resolved
   * from the DB at send time, never stored on the job.
   *
   * O3 order-OTP jobs (jobKind === "order-otp") delegate the same way
   * to HandlerDeps.orderOtpSmsSend (src/orders/otp.ts). Their payload
   * is ids-only EXCEPT otpCode below — see its comment.
   */
  jobKind?: "callcenter-automation" | "order-otp" | "return-update" | "back-in-stock";
  /** Order-OTP flavour marker (jobKind === "order-otp"). */
  purpose?: "order_otp";
  /**
   * Return-update flavour (jobKind === "return-update", doc 17 O7-2):
   * produced by src/orders/return-notify.ts whenever a return changes
   * status. `returnId` + `status` say what changed; `phone` is the
   * recipient number RESOLVED SERVER-SIDE from the Order row at
   * enqueue time — it is never accepted from client input. (This is a
   * deliberate, documented exception to the ids-only habit above: a
   * return can belong to a guest order whose phone exists only on the
   * Order row, and the worker's send path needs the number on the job
   * until a return-specific send handler resolves it from the DB the
   * way the OTP path does. The file-header rule still holds: the
   * number is never written to logs.)
   */
  returnId?: string;
  /** The return's new status (REQUESTED / APPROVED / RECEIVED / EXCHANGED / …). */
  status?: string;
  /** Human order number (ORD-YYYYMMDD-NNNN) for the return-update
   *  message text — resolved server-side by the producer from the
   *  Order row, like `phone`. Jobs enqueued before this field existed
   *  omit it; the send path falls back to the DB. */
  orderNo?: string;
  /**
   * Back-in-stock flavour (jobKind === "back-in-stock", doc 21 G3-9):
   * produced by src/storefront-ux/back-in-stock-notify.ts when a
   * variant's availability crosses 0 -> positive and a signup is
   * waiting. `signupId` is the BackInStockSignup row (also the
   * recipientRef); `phone` is the signup's number, copied from the DB
   * row by the producer — the send path re-reads the row and stamps
   * notifiedAt after a successful send.
   */
  signupId?: string;
  productId?: string;
  /** Recipient phone for a return-update job — see returnId above. */
  phone?: string;
  /**
   * The 6-digit code for an order-OTP job. This is the ONE payload
   * field that carries a secret-shaped value, by necessity: the DB
   * stores only the code's SHA-256 hash, so the job is the only
   * channel that can deliver the plaintext to the worker's send path.
   * It is single-use and dies 10 minutes after issue. It must NEVER
   * be logged — handlers log templateKey / recipientRef / messageId
   * only, and the OTP send path re-validates the code against the
   * stored hash at send time (a re-issue supersedes older jobs,
   * which then skip instead of sending a dead code).
   */
  otpCode?: string;
  /** Automation flavour: NO_ANSWER_SMS / CALLBACK_REMINDER_SMS / RESCUE_SMS. */
  automationKind?: string;
  /** CallTask id the automation belongs to. */
  taskId?: string;
  /** The AUTO_SMS_SCHEDULED CallLogEntry id — the send's idempotency anchor. */
  decisionLogId?: string;
  /** ISO time the send was scheduled for. */
  runAt?: string;
  /** Stable dedupe key (also used as the BullMQ jobId by the producer). */
  idempotencyKey?: string;
}
export interface EmailJob { orderId?: string; templateKey: string; recipientRef: string; }
export interface CourierBookingJob { orderId: string; shipmentId: string; provider: string; }
export interface WebhookJob { event: string; payloadId: string; }
