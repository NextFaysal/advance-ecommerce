// BullMQ queue contracts — Step 17/22/26/31 jobs.
// Slow/external work must go through these queues, never block a request.
// This file defines queue names, job payload types, and retry policy only.
// Workers that call real SMS/email/courier/payment APIs are implemented in
// the jobs worker process ( separate deployment ), using the adapters in
// src/integrations. Payloads must never contain a secret or a full phone
// number in plain text in logs — use masked refs / ids only.
//
// =====================================================================
// QUEUE INVENTORY — ADV-10 audit (doc 22 §ADV-10, doc 21 G3-12)
// Status of every queue as of the ADV-10 wave. "Producer" = code that
// enqueues real jobs today; "consumer" = the handler/runner wired in
// src/jobs/worker-deps.ts. A queue can be fully wired and still wait
// unconsumed in production: no worker host runs yet (doc 21 G2 — the
// VPS lands after development completes), so "live" below means the
// code path is real end to end, not that a daemon is running.
//
//  queue                  producer(s)                              consumer                                   status
//  ---------------------  ---------------------------------------  -----------------------------------------  ------------------
//  sms-send               src/orders/otp.ts (order-otp),           handlers.ts sms + worker-deps delegated    LIVE
//                         src/orders/return-notify.ts              send paths (otp / callcenter / return /
//                         (return-update), src/callcenter/         back-in-stock); generic jobKind-less
//                         automation.ts (callcenter-automation),   branch = handlers.ts generic path
//                         src/storefront-ux/back-in-stock-
//                         notify.ts (back-in-stock)
//  email-send             src/email/send.ts enqueueEmailJob        handlers.ts email -> worker-deps           LIVE
//                         (checkout confirmation, staff invite,    emailSend -> src/email/send.ts
//                         scheduled report delivery; automation    processEmailJob (real Resend transport
//                         send_email effects reuse it)             from Settings, honest skip unconfigured)
//  courier-booking        NONE — booking happens synchronously     handlers.ts courierBooking — STUB:       CONSUMER-STUB,
//                         in the admin shipments route via the     resolves the provider, logs, returns       NO PRODUCER
//                         same adapters (staff waits for the       "succeeded" WITHOUT calling
//                         tracking id)                             createShipment (noted at the handler)
//  courier-status-sync    NONE — statuses arrive via provider      handlers.ts courierSync (real              CONSUMER-ONLY
//                         webhooks (Steadfast webhook ->           provider.getStatus call)
//                         src/courier/order-sync.ts) directly;
//                         a future worker-host poller/cron is
//                         the producer that will feed this queue
//  webhook-delivery       ADV-26 — src/webhooks/dispatch.ts       worker-deps webhookFanout ->           LIVE
//                         fans the lifecycle emit seam out to      src/webhooks/deliver.ts
//                         WebhookEndpoint rows, writes a durable   processWebhookDelivery (real: signed
//                         WebhookDelivery per endpoint and         POST, DB retry state machine
//                         enqueues { event, payloadId: deliveryId } 1m/10m/1h/6h -> DEAD, admin log)
//  import-export          NONE — admin catalog import/export       runners.ts createImportExportRunner        CONSUMER-ONLY
//                         routes run the same catalog services     (real for products; orders/customers
//                         synchronously (preview -> confirm,       throw UNSUPPORTED_ENTITY)
//                         streamed CSV export); this queue is
//                         the async path for future large files
//  report-generation      NONE — the report builder + exports      runners.ts createReportRunner (real:       CONSUMER-ONLY
//                         run synchronously in the admin routes;   computed-summary ref over DB rows;
//                         scheduled reports ride email-send        no result/file store exists)
//                         (src/reports/schedule-delivery.ts
//                         builds the CSV at send time)
//  notification-retry     src/jobs/notification-failures.ts        runners.ts createNotificationRetryRunner   LIVE (ADV-10)
//                         (ADV-10: the worker handlers record a    (re-drives FAILED rows; "sent" ->
//                         FAILED NotificationLog row + enqueue     SENT, sandbox "queued" -> QUEUED)
//                         this job when a direct notification
//                         send exhausts its origin queue)
//  abandoned-cart-        NONE — follow-ups run through            handlers.ts abandonedCart — since          DORMANT-DUPLICATE
//  followup               automation-run (ADV-7 checkout.          ADV-10 returns "skipped" and queues        (no producer;
//                         abandoned producers + rules execute      nothing (it previously claimed a           handler honest)
//                         the real SMS/email effects there)        follow-up was queued — phantom success)
//  automation-run         src/automation/producers.ts              runners.ts createAutomationRunner          LIVE
//                         emitAutomationEvent from the order /     (rule eval + ADV-7 real send_sms /
//                         checkout / inventory funnels             send_email effects + run logs)
//  bulk-actions           app/api/v1/admin/orders bulk POST via    handlers.ts bulkActions -> worker-deps     LIVE (ADV-10:
//                         src/jobs/bulk-actions.ts                 bulkActionsRunner -> processBulkJob        dual trigger +
//                         triggerBulkJobProcessing (BullMQ         (registry read via getBulkJobAsync)        Redis registry)
//                         dispatch + in-process trigger; the
//                         claim in processBulkJob runs it once)
//  subscription-          NONE yet — the worker entrypoint is to     handlers.ts subscriptions -> worker-deps  WIRED, AWAITS
//  generation             enqueue a repeatable sweep job (see       subscriptionRunner -> src/subscriptions/  SCHEDULER
//                         src/subscriptions/generate.ts header)      generate.ts processDueSubscriptions
//                         Pickup OTP SMS rides sms-send with jobKind "pickup-otp"
//                         (producer + send path: src/orders/pickup-otp.ts,
//                         delegated in handlers.ts like order-otp).
//
// Cross-cutting honesty notes:
//  - Notification failure recording (notification-retry's input)
//    covers the DIRECT send seams in handlers.ts only. The delegated
//    SMS flavours keep their own failure records (call-center
//    dead-letter timeline rows, BullMQ dead-letter entries) and are
//    not re-driven by the generic retry runner — their recipientRef
//    is an entity id, not a sendable ref.
//  - Idempotency + dead-letter stores default to in-memory
//    implementations in the worker assembly (worker-deps.ts header);
//    a multi-process worker deployment still needs the Redis/DB
//    versions of those two stores.
// =====================================================================

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
  subscriptions: "subscription-generation",
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
  jobKind?: "callcenter-automation" | "order-otp" | "return-update" | "back-in-stock" | "auth-otp" | "vendor-login-otp" | "pickup-otp";
  /** Vendor-login OTP flavour marker (jobKind === "vendor-login-otp",
   *  ADV-13): the Vendor row id; the phone is resolved from the DB at
   *  send time (src/vendors/portal-otp.ts). */
  vendorId?: string;
  /** Order-OTP flavour marker (jobKind === "order-otp"). */
  purpose?: "order_otp" | "pickup_otp";
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
export interface EmailJob {
  orderId?: string;
  templateKey: string;
  recipientRef: string;
  /** Stable dedupe key (also used as the BullMQ jobId by the producer). */
  idempotencyKey?: string;
  /**
   * Staff-invite flavour (templateKey === "staff_invite", ADV-3):
   * produced by src/email/send.ts from the staff invite routes. The
   * recipient address, the invitee's name/role and the RAW invite
   * link ride on the payload — the link because only the token's
   * SHA-256 hash is ever stored, so the job is the only channel that
   * can carry it to the worker (the otpCode precedent above). None of
   * these fields is ever logged. Order-confirmation jobs carry ids
   * only; their recipient is resolved from the Customer row at send
   * time.
   */
  toEmail?: string;
  inviteLink?: string;
  inviteeName?: string;
  roleName?: string;
  /** Invite expiry (ISO) — rendered into the invite email. */
  expiresAt?: string;
  /**
   * Scheduled-report flavour (templateKey === "report_delivery",
   * ADV-8): produced by src/reports/schedule-delivery.ts. Ids + the
   * covered period only — the send path rebuilds the CSV from the
   * saved definition at send time and attaches it. `toEmail` carries
   * the recipient (one job per recipient).
   */
  reportId?: string;
  scheduleId?: string;
  /** Covered period, Dhaka YYYY-MM-DD bounds. */
  reportPeriodFrom?: string;
  reportPeriodTo?: string;
}
export interface CourierBookingJob { orderId: string; shipmentId: string; provider: string; }
export interface WebhookJob { event: string; payloadId: string; }

/**
 * Subscription generation sweep (ADV-18 remainder): ONE job asks the
 * worker to generate orders for every subscription whose nextRunAt is
 * due (src/subscriptions/generate.ts processDueSubscriptions). The
 * payload carries no subscription ids — the sweep reads the due set
 * from the DB, so a delayed or repeated sweep can never double-create
 * (each cycle's order carries a deterministic idempotency key derived
 * from the subscription + the scheduled run instant).
 * `sweepKey` is the idempotency ref for the job itself (e.g. the
 * scheduled tick's ISO timestamp or a repeatable-job id).
 */
export interface SubscriptionJob { sweepKey: string; }
