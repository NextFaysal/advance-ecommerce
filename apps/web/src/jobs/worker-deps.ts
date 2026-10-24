/**
 * Worker deps assembly — Agent 66 (worker entrypoint slice).
 *
 * Builds the HandlerDeps / WorkerRuntimeDeps that the BullMQ worker
 * entrypoint (apps/web/scripts/worker.ts) hands to createWorkers().
 * This is the ONE place where job handlers meet the real modules of
 * this codebase; handlers.ts itself stays free of deployment wiring.
 *
 * WIRED (real modules behind the dep):
 *  - smsProvider / emailProvider — resolvers. They read the
 *    admin-configured provider name from the settings service
 *    (Admin > Settings: `sms.provider` / `email.provider`, env fallback
 *    SMS_PROVIDER / EMAIL_PROVIDER) and return an adapter for it.
 *    HONEST LIMIT: no real SMS/email adapter exists in the codebase
 *    yet — src/integrations defines the interfaces only, and the only
 *    implementations are the sandbox ones (mirrored here from
 *    handlers.ts, carrying the configured provider's name so logs and
 *    refs never claim a different provider than the one selected).
 *    When a real adapter lands it slots into these resolvers behind
 *    the same names; nothing else changes. Sends are simulated
 *    (status "queued", SBX-style deterministic ids) until then.
 *  - courierProvider — the sandbox courier factory (Steadfast /
 *    Pathao / RedX). Paperfly / eCourier have no adapter at all yet
 *    and throw NO_ADAPTER:<name>, exactly like the handlers' own
 *    default. Real adapters slot behind this same dep later.
 *  - bulkActionsRunner — real: getBulkJob(id) -> processBulkJob(job)
 *    from src/jobs/bulk-actions.ts, the same executor the admin route
 *    triggers in-process today.
 *
 * OMITTED (no real executor exists — the handler then honestly
 * reports "skipped — not configured", which is the truth):
 *  - webhookFanout: src/extensibility/webhooks.ts has signing +
 *    delivery-classification helpers only; nothing performs an actual
 *    outbound delivery.
 *  - reportRunner: src/reports/service.ts aggregates rows it is
 *    handed and renders CSV; nothing loads data for a ReportJob or
 *    writes a report file returning a fileRef.
 *  - automationRunner: src/automation/engine.ts evaluates rules and
 *    describes effects — it deliberately applies nothing, and no
 *    dispatch maps (workflowId, triggerEvent, entityId) to an
 *    executable event.
 *  - importExportRunner: catalog CSV import is synchronous text-in
 *    route logic (src/catalog/import.ts); no fileRef-based job
 *    executor exists.
 *  - notificationRetryRunner: there is no notification-log store or
 *    retry executor in the codebase yet.
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

/* ------------------------------------------------------------------ */
/* Settings lookup — lazy, fail-soft (see the landmine note above)     */
/* ------------------------------------------------------------------ */

/** Env fallback names, mirroring SETTING_ENV_FALLBACK in lib/settings.ts. */
const ENV_FALLBACK: Record<string, string> = {
  "sms.provider": "SMS_PROVIDER",
  "email.provider": "EMAIL_PROVIDER",
};

async function readSetting(key: string): Promise<string | null> {
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
  // Deliberately omitted — see the header for the per-dep reason:
  // webhookFanout, reportRunner, automationRunner,
  // importExportRunner, notificationRetryRunner.
};

export type { HandlerDeps };
