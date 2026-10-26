/**
 * Worker deps assembly — Agent 66 (worker entrypoint slice).
 *
 * Builds the HandlerDeps / WorkerRuntimeDeps that the BullMQ worker
 * entrypoint (apps/web/scripts/worker.ts) hands to createWorkers().
 * This is the ONE place where job handlers meet the real modules of
 * this codebase; handlers.ts itself stays free of deployment wiring.
 *
 * WIRED (real modules behind the dep):
 *  - smsProvider — resolver. It reads the admin-configured provider
 *    name from the settings service (Admin > Settings: `sms.provider`,
 *    env fallback SMS_PROVIDER) and returns an adapter for it.
 *    ADV-2 (doc 22): REAL gateway adapters exist —
 *    src/integrations/sms-providers.ts (BulkSMSBD / SSL Wireless /
 *    GreenWeb) behind the Settings-driven resolver in
 *    src/integrations/sms-resolver.ts. When the active provider (or
 *    the configured fallback) is enabled AND carries its credentials
 *    in encrypted Settings, sends go through the real gateway and
 *    provider failures throw (BullMQ retry / dead-letter). When
 *    nothing is configured, the resolver returns the sandbox adapter
 *    below (mirrored from handlers.ts, carrying the configured
 *    provider's name so logs and refs never claim a different provider
 *    than the one selected) and sends stay simulated + labelled.
 *  - emailSend (ADV-3) — the email-send queue's send path is REAL:
 *    processEmailJob in src/email/send.ts renders the lifecycle
 *    templates (order confirmation, staff invite) and calls the
 *    Resend transport resolved from encrypted Settings by
 *    src/email/config.ts (null = not configured → the job SKIPs,
 *    never a simulated send). The legacy emailProvider resolver
 *    below still returns the sandbox adapter ON PURPOSE: its only
 *    consumer is the notification-retry runner, whose contract
 *    expects a simulated "queued" result (see runners.ts).
 *  - courierProvider — resolver (ADV-5 part 1). For steadfast it
 *    first tries the REAL adapter (src/integrations/steadfast.ts)
 *    behind the Settings-driven resolver in
 *    src/integrations/steadfast-resolver.ts: when
 *    courier.steadfast is enabled AND carries api_key + secret_key in
 *    encrypted Settings, bookings/status go to the live Steadfast API;
 *    otherwise the sandbox factory below stays in use and stays
 *    labelled sandbox. Pathao / RedX remain sandbox-only for now.
 *    Paperfly / eCourier have no adapter at all yet and throw
 *    NO_ADAPTER:<name>, exactly like the handlers' own default.
 *  - bulkActionsRunner — real: getBulkJob(id) -> processBulkJob(job)
 *    from src/jobs/bulk-actions.ts, the same executor the admin route
 *    triggers in-process today.
 *  - The five queue runners from src/jobs/runners.ts — all real
 *    executors over the existing service layer, so no handler reports
 *    "skipped" for them anymore:
 *      webhookFanout — delivers to the DB-registered webhook
 *        subscriptions (signing + classification from
 *        src/extensibility/webhooks.ts; attempts recorded in the
 *        runners' in-memory delivery-log store — no DB table exists
 *        for delivery logs yet, see runners.ts header).
 *      reportRunner — fetchSalesRows + aggregateSales over real DB
 *        rows; returns a computed-summary ref (the reports module
 *        has no result/file store, so no fileRef is ever faked).
 *      automationRunner — the (workflowId, triggerEvent, entityId)
 *        dispatch: rule from the DB automation store, event built
 *        from the entity, engine evaluation, run log persisted
 *        through the store (dry-run jobs are never persisted). ADV-7:
 *        matched runs execute send_sms / send_email for real, and
 *        this assembly injects resolveSmsProvider below — the same
 *        resolver the sms-send queue uses.
 *      importExportRunner — catalog CSV import/export through
 *        src/catalog/import.ts + the Prisma CatalogRepository;
 *        fileRef is a file name inside the local job-files directory
 *        (env AE_JOB_FILES_DIR) — no object storage exists yet.
 *      notificationRetryRunner — re-drives FAILED NotificationLog
 *        rows through the sms/email resolvers above; a successful
 *        re-drive returns the row to QUEUED (simulated send), never
 *        SENT.
 *  - callCenterSmsSend — C4: the send path for call-center automation
 *    SMS jobs, delegated from the SMS handler to
 *    src/callcenter/automation.ts (lazy import — see the dep below).
 *  - returnUpdateSmsSend — doc 21 G3-1: the send path for
 *    return-update SMS jobs, delegated to
 *    src/orders/return-notify.ts (lazy import — see the dep below).
 *  - backInStockSmsSend — doc 21 G3-9: the send path for
 *    back-in-stock SMS jobs, delegated to
 *    src/storefront-ux/back-in-stock-notify.ts (lazy import — see the
 *    dep below).
 *  - callCenterDeadLetter — doc 18 F1: the timeline hook the
 *    processor fires when a call-center automation job exhausts its
 *    retries, delegated to src/callcenter/dead-letter.ts (lazy import
 *    — same pattern as callCenterSmsSend).
 *
 * PRISMA LANDMINE — read before touching the settings import:
 * src/lib/settings.ts imports the Prisma client at module top level,
 * and packages/db instantiates it on import. Until `prisma generate`
 * has run, importing it throws. So the settings service is loaded
 * LAZILY (dynamic import inside the resolver, try/catch) — a missing
 * or broken settings service can never stop the worker from starting
 * or a job from being handled; the resolver falls back to the env
 * fallback names, then to the built-in defaults, and still returns
 * the sandbox adapter. Nothing here imports lib/settings statically.
 *
 * Idempotency / dead-letter stores are intentionally NOT provided:
 * createWorkers() defaults them to the in-memory implementations.
 * A multi-process deployment must replace them with a Redis SETNX /
 * DB-backed store — see docs/RUNBOOK-LOCAL.md, "Worker daemon".
 */
import { consoleJobLogger, type HandlerDeps } from "./handlers";
import type { WorkerRuntimeDeps } from "./workers";
import {
  EMAIL_PROVIDERS,
  type EmailProvider,
  type EmailProviderName,
} from "../integrations/email";
import {
  SMS_PROVIDERS,
  type SmsProvider,
  type SmsProviderName,
} from "../integrations/sms";
import type {
  CourierProvider,
  CourierProviderName,
} from "../integrations/courier";
import type { ProviderConfig } from "../integrations/types";
import {
  createSandboxCourierProvider,
  SANDBOX_COURIER_PROVIDERS,
  type SandboxCourierProvider,
} from "../integrations/sandbox/courier-provider";
import { getBulkJob, processBulkJob } from "./bulk-actions";
import {
  createAutomationRunner,
  createImportExportRunner,
  createNotificationRetryRunner,
  createReportRunner,
  createWebhookFanout,
} from "./runners";

/* ------------------------------------------------------------------ */
/* Settings lookup — lazy, fail-soft (see the landmine note above)     */
/* ------------------------------------------------------------------ */

/** Env fallback names, mirroring SETTING_ENV_FALLBACK in lib/settings.ts. */
const ENV_FALLBACK: Record<string, string> = {
  "sms.provider": "SMS_PROVIDER",
  "email.provider": "EMAIL_PROVIDER",
};

/** Exported for the webhook fanout runner (per-subscription signing
 *  secret lookup: `webhook.secret.<subscriptionId>`). */
export async function readSetting(key: string): Promise<string | null> {
  try {
    const settings = await import("../lib/settings");
    const value = await settings.getSetting(key);
    if (value !== null && value !== "") return value;
  } catch {
    // Settings service unavailable (Prisma client not generated yet, or
    // DB unreachable): fall through to the env fallback below. This is
    // a provider-NAME lookup only — never a credential — so degrading
    // to env/default is safe and is the documented resolution order.
  }
  const envName = ENV_FALLBACK[key];
  if (envName !== undefined) {
    const envValue = process.env[envName];
    if (envValue !== undefined && envValue !== "") return envValue;
  }
  return null;
}

function pickProviderName<TName extends string>(
  configured: string | null,
  allowed: readonly TName[],
  fallback: TName,
): TName {
  if (configured !== null && (allowed as readonly string[]).includes(configured)) {
    return configured as TName;
  }
  return fallback;
}

/* ------------------------------------------------------------------ */
/* Sandbox adapters carrying the configured provider's name.           */
/* Mirrors handlers.ts createSandboxSmsProvider/createSandboxEmail-    */
/* Provider (same simulated result shape); the deterministic suffix    */
/* helper is duplicated because handlers.ts does not export it.        */
/* ------------------------------------------------------------------ */

const sandboxProviderConfig: ProviderConfig = {
  provider: "sandbox",
  enabled: true,
  mode: "sandbox",
  status: "configured",
  credentialRef: null,
  lastTestedAt: null,
  lastError: null,
};

function stableSuffix(parts: readonly string[]): string {
  let hash = 0;
  const joined = parts.join(":");
  for (let i = 0; i < joined.length; i += 1) {
    hash = (hash * 31 + (joined.charCodeAt(i) | 0)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function sandboxSmsProvider(name: SmsProviderName): SmsProvider {
  return {
    name,
    config: sandboxProviderConfig,
    async send(input) {
      return {
        messageId: `sandbox-sms-${stableSuffix([input.templateKey ?? "msg", input.orderId ?? ""])}`,
        status: "queued" as const,
        segments: 1,
      };
    },
  };
}

function sandboxEmailProvider(name: EmailProviderName): EmailProvider {
  return {
    name,
    config: sandboxProviderConfig,
    async send(input) {
      return {
        messageId: `sandbox-email-${stableSuffix([input.templateKey ?? "msg", input.orderId ?? ""])}`,
        status: "queued" as const,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Resolvers                                                           */
/* ------------------------------------------------------------------ */

/** Built-in default in lib/settings.ts SETTING_DEFAULTS ("" = unset). */
const DEFAULT_SMS_PROVIDER: SmsProviderName = "bulksmsbd";
/** Built-in default in lib/settings.ts SETTING_DEFAULTS. */
const DEFAULT_EMAIL_PROVIDER: EmailProviderName = "resend";

async function resolveSmsProvider(providerName: string | null): Promise<SmsProvider> {
  // ADV-2: a configured real gateway wins. The resolver + settings
  // service load lazily (the Prisma landmine note above applies to
  // both), and ANY failure in the real path degrades to the sandbox
  // adapter below — a send is then simulated and labelled simulated,
  // never silently "real".
  try {
    const resolver = await import("../integrations/sms-resolver");
    const resolved = await resolver.resolveConfiguredSmsProvider(
      {
        getSetting: (key) => readSetting(key),
        getProviderSecrets: async (provider) => {
          const settings = await import("../lib/settings");
          return settings.getIntegrationConfigWithSecrets("sms", provider);
        },
      },
      providerName,
    );
    if (resolved !== null) return resolved.provider;
  } catch {
    // fall through to the sandbox adapter
  }
  if (providerName !== null && (SMS_PROVIDERS as readonly string[]).includes(providerName)) {
    return sandboxSmsProvider(providerName as SmsProviderName);
  }
  const configured = await readSetting("sms.provider");
  return sandboxSmsProvider(pickProviderName(configured, SMS_PROVIDERS, DEFAULT_SMS_PROVIDER));
}

async function resolveEmailProvider(providerName: string | null): Promise<EmailProvider> {
  if (providerName !== null && (EMAIL_PROVIDERS as readonly string[]).includes(providerName)) {
    return sandboxEmailProvider(providerName as EmailProviderName);
  }
  const configured = await readSetting("email.provider");
  return sandboxEmailProvider(pickProviderName(configured, EMAIL_PROVIDERS, DEFAULT_EMAIL_PROVIDER));
}

async function resolveCourierProvider(provider: CourierProviderName): Promise<CourierProvider> {
  if (provider === "steadfast") {
    // ADV-5 part 1: a configured live Steadfast wins. The resolver +
    // settings service load lazily (the Prisma landmine note above),
    // and ANY failure in the real path degrades to the sandbox adapter
    // — a booking is then simulated and labelled simulated, never
    // silently "real".
    try {
      const resolver = await import("../integrations/steadfast-resolver");
      const resolved = await resolver.resolveSteadfastCourier({
        getSetting: (key) => readSetting(key),
        getProviderSecrets: async () => {
          const settings = await import("../lib/settings");
          return settings.getIntegrationConfigWithSecrets("courier", "steadfast");
        },
      });
      if (resolved !== null) return resolved.provider;
    } catch {
      // fall through to the sandbox adapter
    }
    return createSandboxCourierProvider("steadfast");
  }
  if ((SANDBOX_COURIER_PROVIDERS as readonly string[]).includes(provider)) {
    return createSandboxCourierProvider(provider as SandboxCourierProvider);
  }
  // No adapter of any kind exists for this provider yet (paperfly /
  // ecourier). Throwing fails the job honestly so BullMQ retries and
  // dead-letters it — never fake a booking.
  throw new Error(`NO_ADAPTER:${provider}`);
}

/* ------------------------------------------------------------------ */
/* Assembled deps for the worker entrypoint                            */
/* ------------------------------------------------------------------ */

export const workerDeps: WorkerRuntimeDeps = {
  logger: consoleJobLogger,
  smsProvider: resolveSmsProvider,
  emailProvider: resolveEmailProvider,
  // C4: call-center automation SMS jobs (sms queue, jobKind
  // "callcenter-automation") delegate here. Lazy import for the same
  // reason as the settings lookups above: the automation module pulls
  // in Prisma + the settings service at module top level, and a load
  // failure there must never stop a job from being handled — the
  // import sits inside the dep, so it resolves per job, in a process
  // where the DB is expected to be reachable.
  callCenterSmsSend: async (job) => {
    const automation = await import("../callcenter/automation");
    return automation.processCallCenterSmsJob(job, { smsProvider: resolveSmsProvider });
  },
  // Doc 18 F1: an exhausted call-center automation job leaves an
  // AUTO_SMS_DEAD_LETTER row on the task timeline (or an OrderNote on
  // the order) via src/callcenter/dead-letter.ts. Lazy import for the
  // same reason as callCenterSmsSend above: the module pulls in
  // Prisma at module top level, and a load failure there must never
  // stop the worker from starting (the processor also treats the
  // hook as best-effort — the DeadLetterEntry is the system record).
  callCenterDeadLetter: async (info) => {
    const deadLetter = await import("../callcenter/dead-letter");
    await deadLetter.recordCallCenterDeadLetter(info);
  },
  // O3: order-OTP SMS jobs (sms queue, jobKind "order-otp") delegate
  // here. Lazy import for the same reason as callCenterSmsSend above:
  // the OTP module pulls in Prisma at module top level, and a load
  // failure there must never stop a job from being handled.
  orderOtpSmsSend: async (job) => {
    const otp = await import("../orders/otp");
    return otp.processOrderOtpSmsJob(job, { smsProvider: resolveSmsProvider });
  },
  // Doc 21 G3-1: return-update SMS jobs (sms queue, jobKind
  // "return-update") delegate here. Lazy import for the same reason
  // as callCenterSmsSend above: the module pulls in Prisma at module
  // top level, and a load failure there must never stop a job from
  // being handled.
  returnUpdateSmsSend: async (job) => {
    const returnNotify = await import("../orders/return-notify");
    return returnNotify.processReturnUpdateSmsJob(job, { smsProvider: resolveSmsProvider });
  },
  // Doc 21 G3-9: back-in-stock SMS jobs (sms queue, jobKind
  // "back-in-stock") delegate here. Lazy import for the same reason
  // as returnUpdateSmsSend above.
  backInStockSmsSend: async (job) => {
    const backInStock = await import("../storefront-ux/back-in-stock-notify");
    return backInStock.processBackInStockSmsJob(job, { smsProvider: resolveSmsProvider });
  },
  // ADV-3: lifecycle email jobs (email-send queue) delegate here.
  // The transport is resolved per job from encrypted Settings via
  // src/email/config.ts — configured → the real Resend adapter,
  // otherwise null and processEmailJob SKIPs honestly. Lazy imports
  // for the same reason as the SMS send paths above: src/email/send
  // pulls in Prisma at module top level.
  emailSend: async (job) => {
    const emailSend = await import("../email/send");
    const emailConfig = await import("../email/config");
    return emailSend.processEmailJob(job, {
      emailTransport: async () => {
        const loaded = await emailConfig.loadEmailTransport();
        return loaded.configured ? loaded.provider : null;
      },
    });
  },
  courierProvider: resolveCourierProvider,
  bulkActionsRunner: async (job) => {
    const bulkJob = getBulkJob(job.bulkJobId);
    if (bulkJob === undefined) {
      // The registry is in-process; a job id this process has never
      // seen cannot be executed here. Throw so the failure is visible
      // (retry / dead-letter), never report a phantom success.
      throw new Error(`BULK_JOB_NOT_FOUND:${job.bulkJobId}`);
    }
    const processed = await processBulkJob(bulkJob);
    return { ref: processed.id, status: processed.status };
  },
  // The five runners (src/jobs/runners.ts) — see the header.
  webhookFanout: createWebhookFanout({ readSetting, logger: consoleJobLogger }),
  reportRunner: createReportRunner({ logger: consoleJobLogger }),
  automationRunner: createAutomationRunner({
    smsProvider: resolveSmsProvider,
    logger: consoleJobLogger,
  }),
  importExportRunner: createImportExportRunner(),
  notificationRetryRunner: createNotificationRetryRunner({
    smsProvider: resolveSmsProvider,
    emailProvider: resolveEmailProvider,
    logger: consoleJobLogger,
  }),
};

export type { HandlerDeps };
