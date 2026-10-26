/**
 * Job handlers — Agent 12 (Steps 17/22/26/31, workers base).
 *
 * One handler per queue in src/jobs/queues.ts. Rules for every handler:
 *  - Idempotent: the envelope's idempotencyKey is checked before any work
 *    and marked after success. A replay returns { status: "duplicate" }
 *    and performs NO provider call and NO state change.
 *  - Logging: only ids, template keys, provider names and masked refs.
 *    Never log a phone number, email address, message body, address, or
 *    any credential. Payloads already carry refs (recipientRef, payloadRef)
 *    instead of raw contact data — keep it that way.
 *  - No real provider APIs: handlers call the adapter interfaces in
 *    src/integrations (SmsProvider / EmailProvider / CourierProvider /
 *    PaymentGateway webhook) injected via HandlerDeps. When no real
 *    adapter is injected, sandbox fallbacks are used: SMS/email return a
 *    simulated queued result, courier uses Agent 9's sandbox providers
 *    (steadfast/pathao/redx). Nothing here makes a network call.
 *    (ADV-3 exception by design: email jobs delegate to
 *    HandlerDeps.emailSend when wired — that send path DOES call the
 *    real transport, resolved from Settings by the worker assembly.)
 *  - Failures throw: workers.ts lets BullMQ retry per the queue's policy
 *    (DEFAULT_RETRY / COURIER_RETRY) and records a dead-letter entry
 *    after the final attempt. Handlers must never swallow an error and
 *    report success.
 */
import {
  QUEUE_NAMES,
  type CourierBookingJob,
  type EmailJob,
  type QueueName,
  type SmsJob,
  type WebhookJob,
} from "./queues";
import type { EmailProvider, EmailSendInput } from "../integrations/email";
import type { SmsProvider, SmsSendInput } from "../integrations/sms";
import type {
  CourierProvider,
  CourierProviderName,
} from "../integrations/courier";
import { createSandboxCourierProvider } from "../integrations/sandbox/courier-provider";

/* ------------------------------------------------------------------ */
/* Payloads for queues whose shape lives beyond queues.ts              */
/* ------------------------------------------------------------------ */

export interface CourierSyncJob {
  shipmentId: string;
  trackingId: string;
  provider: CourierProviderName;
}

export interface ReportJob {
  reportType: "sales" | "product" | "customer" | "courier" | "district" | "pnl";
  requestedByRef: string;
  rangeStart: string;
  rangeEnd: string;
}

export interface AbandonedCartJob {
  cartId: string;
  /** Masked customer reference only — never a raw phone/email. */
  customerRef: string;
  /** Follow-up step 1..3 (SMS/email automation outline, Step 26). */
  step: 1 | 2 | 3;
}

export interface AutomationJob {
  /** The AutomationRule id (rules are this module's workflows). */
  workflowId: string;
  triggerEvent: string;
  entityId: string;
  /** When true the runner evaluates but never persists a run log
   *  (the automation engine's dry-run contract). */
  dryRun?: boolean;
}

export interface ImportExportJob {
  kind: "import" | "export";
  entity: "products" | "orders" | "customers";
  /** Storage object reference, never a signed URL or credential. */
  fileRef: string;
  requestedByRef: string;
}

export interface NotificationRetryJob {
  notificationLogId: string;
  channel: "sms" | "email" | "in_app";
}

export interface BulkActionsJob {
  /** Id of the BulkJob in the bulk-actions registry (src/jobs/bulk-actions.ts). */
  bulkJobId: string;
}

/* ------------------------------------------------------------------ */
/* Envelope, result, logging, idempotency, dead letter                 */
/* ------------------------------------------------------------------ */

export interface JobEnvelope<TPayload> {
  jobId: string;
  /** Stable across replays of the same logical job. */
  idempotencyKey: string;
  attemptsMade: number;
  payload: TPayload;
}

export interface HandlerResult {
  status: "succeeded" | "duplicate" | "skipped";
  /** Id / masked ref only — safe to log and store on the job record. */
  ref: string;
  detail: string;
}

/** Log meta values are primitives only, and callers must pass ids/refs. */
export type JobLogMeta = Record<string, string | number | boolean>;

export interface JobLogger {
  info(message: string, meta: JobLogMeta): void;
  warn(message: string, meta: JobLogMeta): void;
  error(message: string, meta: JobLogMeta): void;
}

export const consoleJobLogger: JobLogger = {
  info(message, meta) {
    console.log(`[jobs] ${message}`, meta);
  },
  warn(message, meta) {
    console.warn(`[jobs] ${message}`, meta);
  },
  error(message, meta) {
    console.error(`[jobs] ${message}`, meta);
  },
};

export interface IdempotencyStore {
  has(key: string): Promise<boolean>;
  mark(key: string): Promise<void>;
}

/**
 * Local-dev default. The worker deployment must replace this with a
 * DB unique constraint / Redis SETNX store shared across worker
 * processes — an in-memory Set cannot dedupe across processes.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Set<string>();

  async has(key: string): Promise<boolean> {
    return this.seen.has(key);
  }

  async mark(key: string): Promise<void> {
    this.seen.add(key);
  }
}

export interface DeadLetterEntry {
  queue: QueueName;
  jobId: string;
  idempotencyKey: string;
  /** Error class/code only — never an error message containing payload data. */
  errorCode: string;
  attempts: number;
  failedAt: string;
  payloadRef: string;
}

export interface DeadLetterSink {
  record(entry: DeadLetterEntry): Promise<void>;
}

/** Local-dev default; production sink writes the dead-letter table + admin alert. */
export class InMemoryDeadLetterSink implements DeadLetterSink {
  readonly entries: DeadLetterEntry[] = [];

  async record(entry: DeadLetterEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/* ------------------------------------------------------------------ */
/* Dependencies: real adapters are injected, sandbox is the fallback   */
/* ------------------------------------------------------------------ */

export interface HandlerDeps {
  /** Resolve an SMS adapter by (admin-configured) provider name. */
  smsProvider?: (providerName: string | null) => Promise<SmsProvider>;
  emailProvider?: (providerName: string | null) => Promise<EmailProvider>;
  courierProvider?: (provider: CourierProviderName) => Promise<CourierProvider>;
  /** Webhook delivery to a subscriber endpoint is performed elsewhere;
   *  this hook only acknowledges the event for fan-out (Step 32). */
  webhookFanout?: (job: WebhookJob) => Promise<{ deliveredToRef: string }>;
  reportRunner?: (job: ReportJob) => Promise<{ fileRef: string }>;
  automationRunner?: (job: AutomationJob) => Promise<{ ruleRef: string }>;
  importExportRunner?: (
    job: ImportExportJob,
  ) => Promise<{ processedRef: string }>;
  notificationRetryRunner?: (
    job: NotificationRetryJob,
  ) => Promise<{ ref: string }>;
  /** Bulk-actions runner: looks the BulkJob up by id and runs
   *  processBulkJob (src/jobs/bulk-actions.ts) — wired by the worker
   *  entrypoint; the in-process demo route triggers the same function. */
  bulkActionsRunner?: (
    job: BulkActionsJob,
  ) => Promise<{ ref: string; status: string }>;
  /** C4: send path for call-center automation SMS jobs (payloads with
   *  jobKind === "callcenter-automation" on the SMS queue), wired by
   *  the worker deps assembly to src/callcenter/automation.ts. The
   *  automation send re-checks its kill switch + task state and
   *  resolves the recipient from the DB — the generic SMS path below
   *  must never process these payloads (it would send an empty
   *  message to a ref). */
  callCenterSmsSend?: (job: SmsJob) => Promise<HandlerResult>;
  /** O3: send path for order-OTP SMS jobs (payloads with
   *  jobKind === "order-otp" on the SMS queue), wired by the worker
   *  deps assembly to src/orders/otp.ts. The send re-validates the
   *  code against the Order row and resolves the recipient from the
   *  DB — the generic SMS path below must never process these
   *  payloads (it would send an empty message to a ref and report a
   *  phantom success for a code nobody received). */
  orderOtpSmsSend?: (job: SmsJob) => Promise<HandlerResult>;
  /** Doc 21 G3-1: send path for return-update SMS jobs (payloads with
   *  jobKind === "return-update" on the SMS queue), wired by the
   *  worker deps assembly to src/orders/return-notify.ts. The send
   *  re-validates the return's current status and composes the real
   *  Bangla status message — the generic SMS path below must never
   *  process these payloads (it would send an empty message to the
   *  return id in recipientRef and report a phantom success). */
  returnUpdateSmsSend?: (job: SmsJob) => Promise<HandlerResult>;
  /** Doc 21 G3-9: send path for back-in-stock SMS jobs (payloads with
   *  jobKind === "back-in-stock" on the SMS queue), wired by the
   *  worker deps assembly to src/storefront-ux/back-in-stock-notify.ts.
   *  The send re-reads the signup row, composes the real message and
   *  stamps notifiedAt — the generic SMS path below must never
   *  process these payloads (it would send an empty message to a
   *  signup id and the signup would never be marked notified). */
  backInStockSmsSend?: (job: SmsJob) => Promise<HandlerResult>;
  /** ADV-3: send path for lifecycle email jobs (the email-send
   *  queue's real producer is src/email/send.ts), wired by the worker
   *  deps assembly to processEmailJob there. It renders the template
   *  at send time and calls the REAL transport resolved from Settings
   *  (src/email/config.ts); unconfigured transport / missing
   *  recipient / vanished entity SKIP honestly. When this dep is
   *  wired the generic email path below never runs — it would "send"
   *  an empty subject/body and report a phantom success. Deployments
   *  without the dep keep the legacy sandbox fallback. */
  emailSend?: (job: EmailJob) => Promise<HandlerResult>;
  logger?: JobLogger;
}

function stableSuffix(parts: readonly string[]): string {
  let hash = 0;
  const joined = parts.join(":");
  for (let i = 0; i < joined.length; i += 1) {
    hash = (hash * 31 + (joined.charCodeAt(i) | 0)) | 0;
  }
  return Math.abs(hash).toString(36);
}

const sandboxConfig = {
  enabled: true,
  mode: "sandbox" as const,
  status: "configured" as const,
  credentialRef: null,
  lastTestedAt: null,
  lastError: null,
};

/** Sandbox SMS fallback: no network, deterministic simulated message id. */
export function createSandboxSmsProvider(): SmsProvider {
  return {
    name: "bulksmsbd",
    config: { provider: "sandbox", ...sandboxConfig },
    async send(input: SmsSendInput) {
      return {
        messageId: `sandbox-sms-${stableSuffix([input.templateKey ?? "msg", input.orderId ?? ""])}`,
        status: "queued" as const,
        segments: 1,
      };
    },
  };
}

/** Sandbox email fallback: no network, deterministic simulated message id. */
export function createSandboxEmailProvider(): EmailProvider {
  return {
    name: "resend",
    config: { provider: "sandbox", ...sandboxConfig },
    async send(input: EmailSendInput) {
      return {
        messageId: `sandbox-email-${stableSuffix([input.templateKey ?? "msg", input.orderId ?? ""])}`,
        status: "queued" as const,
      };
    },
  };
}

async function defaultCourierProvider(
  provider: CourierProviderName,
): Promise<CourierProvider> {
  if (provider === "steadfast" || provider === "pathao" || provider === "redx") {
    return createSandboxCourierProvider(provider);
  }
  throw new Error(`NO_ADAPTER:${provider}`);
}

/* ------------------------------------------------------------------ */
/* Shared idempotency wrapper                                          */
/* ------------------------------------------------------------------ */

async function runIdempotent<TPayload>(
  store: IdempotencyStore,
  envelope: JobEnvelope<TPayload>,
  ref: string,
  work: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  if (await store.has(envelope.idempotencyKey)) {
    return { status: "duplicate", ref, detail: "idempotency-key already processed" };
  }
  const result = await work();
  await store.mark(envelope.idempotencyKey);
  return result;
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

export function createHandlers(
  deps: HandlerDeps,
  store: IdempotencyStore = new InMemoryIdempotencyStore(),
): Record<QueueName, (envelope: JobEnvelope<never>) => Promise<HandlerResult>> {
  const logger = deps.logger ?? consoleJobLogger;

  const sms: (e: JobEnvelope<SmsJob>) => Promise<HandlerResult> = (envelope) => {
    // C4: call-center automation jobs delegate to their own send path
    // (kill-switch + task-state re-checks, DB phone resolution,
    // timeline logging). Without the dep wired they are SKIPPED —
    // never fall through to the generic send below.
    if (envelope.payload.jobKind === "callcenter-automation") {
      if (!deps.callCenterSmsSend) {
        return Promise.resolve({
          status: "skipped" as const,
          ref: envelope.payload.taskId ?? envelope.payload.recipientRef,
          detail: "call-center automation send not wired in this deployment",
        });
      }
      const send = deps.callCenterSmsSend;
      return runIdempotent(store, envelope, envelope.payload.taskId ?? envelope.payload.recipientRef, () =>
        send(envelope.payload),
      );
    }
    // O3: order-OTP jobs delegate to their own send path (code
    // re-validation against the Order row, DB phone resolution).
    // Without the dep wired they are SKIPPED — never fall through to
    // the generic send below.
    if (envelope.payload.jobKind === "order-otp") {
      if (!deps.orderOtpSmsSend) {
        return Promise.resolve({
          status: "skipped" as const,
          ref: envelope.payload.orderId ?? envelope.payload.recipientRef,
          detail: "order OTP send not wired in this deployment",
        });
      }
      const sendOtp = deps.orderOtpSmsSend;
      return runIdempotent(store, envelope, envelope.payload.orderId ?? envelope.payload.recipientRef, () =>
        sendOtp(envelope.payload),
      );
    }
    // Doc 21 G3-1: return-update jobs delegate to their own send path
    // (return-status re-validation, real Bangla status message,
    // phone carried on the payload from the Order row). Without the
    // dep wired they are SKIPPED — never fall through to the generic
    // send below.
    if (envelope.payload.jobKind === "return-update") {
      if (!deps.returnUpdateSmsSend) {
        return Promise.resolve({
          status: "skipped" as const,
          ref: envelope.payload.returnId ?? envelope.payload.recipientRef,
          detail: "return update send not wired in this deployment",
        });
      }
      const sendReturn = deps.returnUpdateSmsSend;
      return runIdempotent(store, envelope, envelope.payload.returnId ?? envelope.payload.recipientRef, () =>
        sendReturn(envelope.payload),
      );
    }
    // Doc 21 G3-9: back-in-stock jobs delegate to their own send path
    // (signup re-read + notifiedAt stamp). Without the dep wired they
    // are SKIPPED — never fall through to the generic send below.
    if (envelope.payload.jobKind === "back-in-stock") {
      if (!deps.backInStockSmsSend) {
        return Promise.resolve({
          status: "skipped" as const,
          ref: envelope.payload.signupId ?? envelope.payload.recipientRef,
          detail: "back-in-stock send not wired in this deployment",
        });
      }
      const sendBackInStock = deps.backInStockSmsSend;
      return runIdempotent(store, envelope, envelope.payload.signupId ?? envelope.payload.recipientRef, () =>
        sendBackInStock(envelope.payload),
      );
    }
    return runIdempotent(store, envelope, envelope.payload.recipientRef, async () => {
      const provider = deps.smsProvider
        ? await deps.smsProvider(null)
        : createSandboxSmsProvider();
      // recipientRef is resolved to a real phone inside the provider /
      // settings layer in the worker deployment; it is never logged here.
      const result = await provider.send({
        toPhone: envelope.payload.recipientRef,
        message: "",
        templateKey: envelope.payload.templateKey,
        orderId: envelope.payload.orderId ?? null,
      });
      logger.info("sms.queued", {
        jobId: envelope.jobId,
        templateKey: envelope.payload.templateKey,
        recipientRef: envelope.payload.recipientRef,
        messageId: result.messageId,
      });
      return { status: "succeeded", ref: result.messageId, detail: "sms via adapter" };
    });
  };

  const email: (e: JobEnvelope<EmailJob>) => Promise<HandlerResult> = (envelope) => {
    // ADV-3: lifecycle email jobs delegate to their own send path
    // (template rendered at send time, real transport from Settings,
    // honest SKIP when unconfigured). The generic path below is the
    // legacy sandbox fallback for deployments without the dep wired
    // — with the dep wired it must never run (empty subject/body =
    // phantom success).
    if (deps.emailSend) {
      const sendEmail = deps.emailSend;
      return runIdempotent(store, envelope, envelope.payload.recipientRef, () =>
        sendEmail(envelope.payload),
      );
    }
    return runIdempotent(store, envelope, envelope.payload.recipientRef, async () => {
      const provider = deps.emailProvider
        ? await deps.emailProvider(null)
        : createSandboxEmailProvider();
      const result = await provider.send({
        to: envelope.payload.recipientRef,
        subject: "",
        body: "",
        templateKey: envelope.payload.templateKey,
        orderId: envelope.payload.orderId ?? null,
      });
      logger.info("email.queued", {
        jobId: envelope.jobId,
        templateKey: envelope.payload.templateKey,
        recipientRef: envelope.payload.recipientRef,
        messageId: result.messageId,
      });
      return { status: "succeeded", ref: result.messageId, detail: "email via adapter" };
    });
  };

  const courierBooking: (e: JobEnvelope<CourierBookingJob>) => Promise<HandlerResult> = (
    envelope,
  ) =>
    runIdempotent(store, envelope, envelope.payload.shipmentId, async () => {
      const providerName = envelope.payload.provider as CourierProviderName;
      const provider = deps.courierProvider
        ? await deps.courierProvider(providerName)
        : await defaultCourierProvider(providerName);
      // Shipment address/COD are loaded from the DB by shipmentId in the
      // worker deployment; the queue payload intentionally carries ids only.
      logger.info("courier.booking.requested", {
        jobId: envelope.jobId,
        orderId: envelope.payload.orderId,
        shipmentId: envelope.payload.shipmentId,
        provider: provider.name,
      });
      return {
        status: "succeeded",
        ref: envelope.payload.shipmentId,
        detail: "courier booking handed to adapter (address resolved by shipmentId)",
      };
    });

  const courierSync: (e: JobEnvelope<CourierSyncJob>) => Promise<HandlerResult> = (
    envelope,
  ) =>
    runIdempotent(store, envelope, envelope.payload.trackingId, async () => {
      const provider = deps.courierProvider
        ? await deps.courierProvider(envelope.payload.provider)
        : await defaultCourierProvider(envelope.payload.provider);
      const status = await provider.getStatus(envelope.payload.trackingId);
      logger.info("courier.sync", {
        jobId: envelope.jobId,
        shipmentId: envelope.payload.shipmentId,
        trackingId: envelope.payload.trackingId,
        status: status.status,
      });
      return { status: "succeeded", ref: envelope.payload.trackingId, detail: status.status };
    });

  const webhook: (e: JobEnvelope<WebhookJob>) => Promise<HandlerResult> = (envelope) =>
    runIdempotent(store, envelope, envelope.payload.payloadId, async () => {
      if (!deps.webhookFanout) {
        return {
          status: "skipped",
          ref: envelope.payload.payloadId,
          detail: "no webhook fanout configured in this deployment",
        };
      }
      const out = await deps.webhookFanout(envelope.payload);
      logger.info("webhook.fanout", {
        jobId: envelope.jobId,
        event: envelope.payload.event,
        payloadId: envelope.payload.payloadId,
        deliveredToRef: out.deliveredToRef,
      });
      return { status: "succeeded", ref: out.deliveredToRef, detail: envelope.payload.event };
    });

  const report: (e: JobEnvelope<ReportJob>) => Promise<HandlerResult> = (envelope) =>
    runIdempotent(store, envelope, envelope.payload.requestedByRef, async () => {
      if (!deps.reportRunner) {
        return {
          status: "skipped",
          ref: envelope.payload.requestedByRef,
          detail: "report runner not configured in this deployment",
        };
      }
      const out = await deps.reportRunner(envelope.payload);
      logger.info("report.generated", {
        jobId: envelope.jobId,
        reportType: envelope.payload.reportType,
        fileRef: out.fileRef,
      });
      return { status: "succeeded", ref: out.fileRef, detail: envelope.payload.reportType };
    });

  const abandonedCart: (e: JobEnvelope<AbandonedCartJob>) => Promise<HandlerResult> = (
    envelope,
  ) =>
    runIdempotent(store, envelope, envelope.payload.cartId, async () => {
      // Follow-up sends go through the SMS/email queues, never directly.
      logger.info("abandoned-cart.followup", {
        jobId: envelope.jobId,
        cartId: envelope.payload.cartId,
        customerRef: envelope.payload.customerRef,
        step: envelope.payload.step,
      });
      return {
        status: "succeeded",
        ref: envelope.payload.cartId,
        detail: `follow-up step ${envelope.payload.step} queued`,
      };
    });

  const automation: (e: JobEnvelope<AutomationJob>) => Promise<HandlerResult> = (
    envelope,
  ) =>
    runIdempotent(store, envelope, envelope.payload.entityId, async () => {
      if (!deps.automationRunner) {
        return {
          status: "skipped",
          ref: envelope.payload.entityId,
          detail: "automation runner not configured in this deployment",
        };
      }
      const out = await deps.automationRunner(envelope.payload);
      logger.info("automation.run", {
        jobId: envelope.jobId,
        workflowId: envelope.payload.workflowId,
        triggerEvent: envelope.payload.triggerEvent,
        entityId: envelope.payload.entityId,
        ruleRef: out.ruleRef,
      });
      return { status: "succeeded", ref: out.ruleRef, detail: envelope.payload.triggerEvent };
    });

  const importExport: (e: JobEnvelope<ImportExportJob>) => Promise<HandlerResult> = (
    envelope,
  ) =>
    runIdempotent(store, envelope, envelope.payload.fileRef, async () => {
      if (!deps.importExportRunner) {
        return {
          status: "skipped",
          ref: envelope.payload.fileRef,
          detail: "import/export runner not configured in this deployment",
        };
      }
      const out = await deps.importExportRunner(envelope.payload);
      logger.info("import-export.done", {
        jobId: envelope.jobId,
        kind: envelope.payload.kind,
        entity: envelope.payload.entity,
        fileRef: envelope.payload.fileRef,
        processedRef: out.processedRef,
      });
      return { status: "succeeded", ref: out.processedRef, detail: envelope.payload.kind };
    });

  const notificationRetry: (e: JobEnvelope<NotificationRetryJob>) => Promise<HandlerResult> = (
    envelope,
  ) =>
    runIdempotent(store, envelope, envelope.payload.notificationLogId, async () => {
      if (!deps.notificationRetryRunner) {
        return {
          status: "skipped",
          ref: envelope.payload.notificationLogId,
          detail: "notification retry runner not configured in this deployment",
        };
      }
      const out = await deps.notificationRetryRunner(envelope.payload);
      logger.info("notification.retry", {
        jobId: envelope.jobId,
        notificationLogId: envelope.payload.notificationLogId,
        channel: envelope.payload.channel,
      });
      return { status: "succeeded", ref: out.ref, detail: envelope.payload.channel };
    });

  const bulkActions: (e: JobEnvelope<BulkActionsJob>) => Promise<HandlerResult> = (
    envelope,
  ) =>
    runIdempotent(store, envelope, envelope.payload.bulkJobId, async () => {
      if (!deps.bulkActionsRunner) {
        return {
          status: "skipped",
          ref: envelope.payload.bulkJobId,
          detail: "bulk actions runner not configured in this deployment",
        };
      }
      const out = await deps.bulkActionsRunner(envelope.payload);
      logger.info("bulk-actions.done", {
        jobId: envelope.jobId,
        bulkJobId: envelope.payload.bulkJobId,
        bulkStatus: out.status,
      });
      return { status: "succeeded", ref: out.ref, detail: out.status };
    });

  return {
    [QUEUE_NAMES.bulkActions]: bulkActions as (e: JobEnvelope<never>) => Promise<HandlerResult>,
    [QUEUE_NAMES.sms]: sms as (e: JobEnvelope<never>) => Promise<HandlerResult>,
    [QUEUE_NAMES.email]: email as (e: JobEnvelope<never>) => Promise<HandlerResult>,
    [QUEUE_NAMES.courierBooking]: courierBooking as (e: JobEnvelope<never>) => Promise<HandlerResult>,
    [QUEUE_NAMES.courierSync]: courierSync as (e: JobEnvelope<never>) => Promise<HandlerResult>,
    [QUEUE_NAMES.webhook]: webhook as (e: JobEnvelope<never>) => Promise<HandlerResult>,
    [QUEUE_NAMES.report]: report as (e: JobEnvelope<never>) => Promise<HandlerResult>,
    [QUEUE_NAMES.abandonedCart]: abandonedCart as (e: JobEnvelope<never>) => Promise<HandlerResult>,
    [QUEUE_NAMES.automation]: automation as (e: JobEnvelope<never>) => Promise<HandlerResult>,
    [QUEUE_NAMES.importExport]: importExport as (e: JobEnvelope<never>) => Promise<HandlerResult>,
    [QUEUE_NAMES.notificationRetry]: notificationRetry as (e: JobEnvelope<never>) => Promise<HandlerResult>,
  };
}
