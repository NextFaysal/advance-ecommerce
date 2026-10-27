/**
 * Lifecycle email — producer + worker send path (ADV-3, doc 22).
 *
 * PRODUCER (top half): the email-send queue existed since the jobs
 * base with handlers but NO producer — nothing could ever enqueue an
 * email. enqueueEmailJob() is the generic seam; the two lifecycle
 * producers below are what call sites use:
 *   - enqueueOrderConfirmationEmail(orderId) — public checkout, after
 *     the create transaction commits. Ids-only payload; the recipient
 *     is the Customer row's email, checked again at send time.
 *   - enqueueStaffInviteEmail(...) — staff invite create/resend. The
 *     raw invite link rides on the payload because only the token's
 *     SHA-256 hash is stored (the otpCode precedent in queues.ts: the
 *     job is the only channel that can carry it to the worker). It is
 *     never logged.
 *
 * HONESTY — delivery: enqueueing is NOT delivery, and a queued job is
 * NOT a sent email. Delivery needs the worker process (VPS) AND a
 * configured transport (src/email/config.ts). Every outcome is
 * reported exactly: { email: "queued" } only when the job really
 * landed in Redis, { email: "not_queued", reason } otherwise; the
 * send path SKIPs (never fakes) when the transport is unconfigured,
 * the recipient has no email, or the entity vanished — and THROWS on
 * a provider-reported failure so BullMQ retries / dead-letters.
 *
 * SEND PATH (bottom half): processEmailJob, wired via
 * HandlerDeps.emailSend (src/jobs/worker-deps.ts). Templates are
 * rendered HERE, at send time, from current DB state — an order that
 * was cancelled before the worker ran still gets the confirmation it
 * was owed at creation (the job announces creation, nothing else).
 */
import { prisma } from "@advance-ecommerce/db";
import type { EmailProvider } from "../integrations/email";
import { QUEUE_NAMES, type EmailJob } from "../jobs/queues";
import { bullMqJobOptions } from "../jobs/workers";
import type { HandlerResult } from "../jobs/handlers";
import {
  renderOrderConfirmationEmail,
  renderReportDeliveryEmail,
  renderStaffInviteEmail,
  type EmailLocale,
} from "./templates";

/* ------------------------------------------------------------------ */
/* Producer: email jobs on the email-send queue. bullmq / ioredis      */
/* load dynamically (the return-notify.ts pattern) so this module      */
/* never hard-fails a request path when the queue stack is             */
/* unavailable — enqueue failure is a returned outcome, never thrown    */
/* out of the lifecycle producers.                                     */
/* ------------------------------------------------------------------ */

export interface EmailQueueLike {
  add(
    name: string,
    data: EmailJob,
    opts: Record<string, unknown>,
  ): Promise<{ id?: string }>;
}

interface BullMqProducerShape {
  Queue: new (name: string, opts: { connection: unknown }) => EmailQueueLike;
}

interface RedisConstructorLike {
  new (url: string, options: { maxRetriesPerRequest: null }): unknown;
}

interface IoRedisShape {
  default?: RedisConstructorLike;
  Redis?: RedisConstructorLike;
}

/** Literal dynamic imports — never a variable specifier (Next.js
 *  server bundler cannot resolve those at runtime). bullmq/ioredis
 *  are in next.config serverExternalPackages. */
async function loadBullMq(): Promise<BullMqProducerShape> {
  return (await import("bullmq")) as unknown as BullMqProducerShape;
}

async function loadIoRedis(): Promise<IoRedisShape> {
  return (await import("ioredis")) as unknown as IoRedisShape;
}

let emailQueuePromise: Promise<EmailQueueLike> | null = null;

function getEmailQueue(): Promise<EmailQueueLike> {
  if (emailQueuePromise === null) {
    emailQueuePromise = (async () => {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl === undefined || redisUrl === "") {
        throw new Error("REDIS_URL not set");
      }
      const bullmq = await loadBullMq();
      const ioredis = await loadIoRedis();
      const RedisCtor = ioredis.default ?? ioredis.Redis;
      if (typeof RedisCtor !== "function") throw new Error("ioredis constructor missing");
      const connection = new RedisCtor(redisUrl, { maxRetriesPerRequest: null });
      return new bullmq.Queue(QUEUE_NAMES.email, { connection });
    })();
    // A failed construction must not poison the process — the next
    // enqueue retries (e.g. after REDIS_URL appears).
    emailQueuePromise.catch(() => {
      emailQueuePromise = null;
    });
  }
  return emailQueuePromise;
}

export type EnqueueEmailResult =
  | { email: "queued"; jobId: string }
  | { email: "not_queued"; reason: string };

/**
 * The generic enqueue seam other code calls. `job.idempotencyKey`
 * becomes the BullMQ jobId, so a retried producer call for the same
 * logical email returns the existing job instead of a duplicate.
 * `injectedQueue` exists for tests; production passes nothing.
 */
export async function enqueueEmailJob(
  job: EmailJob,
  jobName: string,
  injectedQueue?: EmailQueueLike,
): Promise<EnqueueEmailResult> {
  if (injectedQueue === undefined && (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "")) {
    return { email: "not_queued", reason: "queue-unavailable: REDIS_URL not set" };
  }
  const jobId = job.idempotencyKey ?? `${job.templateKey}-${job.recipientRef}`;
  try {
    const queue = injectedQueue ?? (await getEmailQueue());
    const added = await queue.add(jobName, job, {
      ...bullMqJobOptions(QUEUE_NAMES.email),
      jobId,
    });
    return { email: "queued", jobId: added.id ?? jobId };
  } catch (error) {
    return {
      email: "not_queued",
      reason: `queue-unavailable: ${error instanceof Error ? error.name : "unknown-error"}`,
    };
  }
}

/**
 * Order-confirmation email for a freshly created order. Checkout is
 * phone-first, so an email exists only when the customer provided
 * one (checkout form) or already had one on their Customer row —
 * without one there is nothing to send to and the result says so.
 */
export async function enqueueOrderConfirmationEmail(
  orderId: string,
): Promise<EnqueueEmailResult> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, customerId: true },
  });
  if (order === null) return { email: "not_queued", reason: "order-not-found" };
  const customer = await prisma.customer.findFirst({
    where: { id: order.customerId, deletedAt: null },
    select: { email: true },
  });
  const toEmail = (customer?.email ?? "").trim();
  if (toEmail === "") return { email: "not_queued", reason: "customer-email-missing" };
  const job: EmailJob = {
    orderId: order.id,
    templateKey: "order_confirmation",
    recipientRef: order.id,
    idempotencyKey: `order-confirmation-${order.id}`,
  };
  return enqueueEmailJob(job, "order-confirmation-email");
}

export interface StaffInviteEmailInput {
  userId: string;
  toEmail: string;
  inviteeName: string;
  roleName: string;
  /** One-time accept link (raw token) — payload-only, never stored. */
  inviteLink: string;
  expiresAtIso: string;
}

/**
 * Staff-invite email for a created/resent invite. The idempotency key
 * includes the expiry, which is minted fresh per invite generation —
 * a resend (new token, new expiry) is a NEW job, while a retried
 * request for the same generation replays the existing one.
 */
export async function enqueueStaffInviteEmail(
  input: StaffInviteEmailInput,
  injectedQueue?: EmailQueueLike,
): Promise<EnqueueEmailResult> {
  const toEmail = input.toEmail.trim();
  if (toEmail === "") return { email: "not_queued", reason: "invitee-email-missing" };
  const job: EmailJob = {
    templateKey: "staff_invite",
    recipientRef: input.userId,
    toEmail,
    inviteLink: input.inviteLink,
    inviteeName: input.inviteeName,
    roleName: input.roleName,
    expiresAt: input.expiresAtIso,
    idempotencyKey: `staff-invite-${input.userId}-${input.expiresAtIso}`,
  };
  return enqueueEmailJob(job, "staff-invite-email", injectedQueue);
}

/* ------------------------------------------------------------------ */
/* Send path (worker process — HandlerDeps.emailSend)                  */
/* ------------------------------------------------------------------ */

export interface EmailJobSendDeps {
  /** Resolves the REAL email transport, or null when none is
   *  configured (worker-deps wires src/email/config.ts). Null is an
   *  honest SKIP, never a simulated send. */
  emailTransport: () => Promise<EmailProvider | null>;
  /** Store identity for template rendering; defaults to Settings
   *  (general.store_name + general.locale) read at send time. */
  storeIdentity?: () => Promise<{ storeName: string; locale: EmailLocale }>;
}

async function defaultStoreIdentity(): Promise<{ storeName: string; locale: EmailLocale }> {
  try {
    const settings = await import("../lib/settings");
    const [storeName, locale] = await Promise.all([
      settings.getSetting("general.store_name"),
      settings.getSetting("general.locale"),
    ]);
    return {
      storeName: (storeName ?? "").trim(),
      locale: locale === "en" ? "en" : "bn",
    };
  } catch {
    return { storeName: "", locale: "bn" };
  }
}

/** Merchant template override for one job, resolved for the send
 *  locale at SEND time (ADV-29 — src/templates/overrides.ts), so
 *  worker-sent mail carries the same copy as anything rendered in
 *  the web process. Any failure resolves to "no override": a broken
 *  override document must never block an email. */
async function emailCopyOverride(
  key: "order_confirmation" | "staff_invite" | "report_delivery",
  locale: EmailLocale,
) {
  try {
    const { resolveEmailCopy } = await import("../templates/overrides");
    return (await resolveEmailCopy(key, locale)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fire one queued lifecycle email (ADV-3). See the header for the
 * honesty contract; in short: unconfigured transport / vanished
 * entity / missing recipient → "skipped"; provider failure → throw.
 */
export async function processEmailJob(
  job: EmailJob,
  deps: EmailJobSendDeps,
): Promise<HandlerResult> {
  const ref = job.orderId ?? job.recipientRef;
  const provider = await deps.emailTransport();
  if (provider === null) {
    return {
      status: "skipped",
      ref,
      detail: "email transport not configured (Settings email.*)",
    };
  }
  const identity = await (deps.storeIdentity ?? defaultStoreIdentity)();

  if (job.templateKey === "order_confirmation") {
    const orderId = job.orderId ?? (job.recipientRef !== "" ? job.recipientRef : undefined);
    if (orderId === undefined) {
      return { status: "skipped", ref, detail: "malformed order_confirmation payload" };
    }
    const order = await prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        orderNo: true,
        customerName: true,
        totalPoisha: true,
        paymentMethod: true,
        customerId: true,
      },
    });
    if (order === null) {
      return { status: "skipped", ref, detail: "order not found at send time" };
    }
    const customer = await prisma.customer.findFirst({
      where: { id: order.customerId, deletedAt: null },
      select: { email: true },
    });
    const toEmail = (customer?.email ?? "").trim();
    if (toEmail === "") {
      return { status: "skipped", ref, detail: "customer has no email on file" };
    }
    const rendered = renderOrderConfirmationEmail({
      locale: identity.locale,
      storeName: identity.storeName,
      customerName: order.customerName,
      orderNo: order.orderNo,
      totalPoisha: order.totalPoisha,
      paymentMethod: String(order.paymentMethod),
      copyOverride: await emailCopyOverride("order_confirmation", identity.locale),
    });
    const result = await provider.send({
      to: toEmail,
      subject: rendered.subject,
      body: rendered.text,
      html: rendered.html,
      templateKey: job.templateKey,
      orderId: order.id,
    });
    if (result.status === "failed") throw new Error("EMAIL_SEND_FAILED:provider");
    return { status: "succeeded", ref: result.messageId, detail: "order confirmation email via adapter" };
  }

  if (job.templateKey === "staff_invite") {
    const toEmail = (job.toEmail ?? "").trim();
    const inviteLink = (job.inviteLink ?? "").trim();
    if (toEmail === "" || inviteLink === "") {
      return { status: "skipped", ref, detail: "malformed staff_invite payload" };
    }
    const rendered = renderStaffInviteEmail({
      locale: identity.locale,
      storeName: identity.storeName,
      inviteeName: job.inviteeName ?? "",
      roleName: job.roleName ?? "",
      inviteLink,
      expiresAtIso: job.expiresAt ?? "",
      copyOverride: await emailCopyOverride("staff_invite", identity.locale),
    });
    const result = await provider.send({
      to: toEmail,
      subject: rendered.subject,
      body: rendered.text,
      html: rendered.html,
      templateKey: job.templateKey,
      orderId: null,
    });
    if (result.status === "failed") throw new Error("EMAIL_SEND_FAILED:provider");
    return { status: "succeeded", ref: result.messageId, detail: "staff invite email via adapter" };
  }

  if (job.templateKey === "report_delivery") {
    // ADV-8: scheduled report. Ids + period only on the job — the
    // saved definition is loaded NOW (so an edited definition is
    // what ships), the CSV is rebuilt from current data for the
    // job's period and attached. Deleted report / malformed job →
    // skipped; provider failure → throw (retry/dead-letter).
    const toEmail = (job.toEmail ?? "").trim();
    const reportId = (job.reportId ?? "").trim();
    const from = (job.reportPeriodFrom ?? "").trim();
    const to = (job.reportPeriodTo ?? "").trim();
    if (toEmail === "" || reportId === "" || from === "" || to === "") {
      return { status: "skipped", ref, detail: "malformed report_delivery payload" };
    }
    const { listSavedReports, prismaKeyValueStore } = await import("../reports/saved-reports");
    const { buildReport, builtReportToCsv, buildExportWatermark, describeDefinition } = await import("../reports/builder");
    const { fetchSalesRows } = await import("../reports/db-rows");
    const saved = (await listSavedReports(prismaKeyValueStore())).find((r) => r.id === reportId);
    if (saved === undefined) {
      return { status: "skipped", ref, detail: "saved report no longer exists" };
    }
    const definition = { ...saved.definition, range: { from, to } };
    const rows = await fetchSalesRows({ from, to });
    const built = buildReport(definition, rows, identity.locale);
    const watermark = buildExportWatermark({
      title: `SCHEDULED REPORT — ${saved.name}`,
      exportedBy: `schedule:${job.scheduleId ?? "unknown"}`,
      exportedAt: new Date(),
      reason: "Scheduled report delivery (ADV-8)",
      range: { from, to },
      rowCount: built.rows.length,
      definitionSummary: describeDefinition(definition),
    });
    const csv = builtReportToCsv(built, watermark);
    const rendered = renderReportDeliveryEmail({
      locale: identity.locale,
      storeName: identity.storeName,
      reportName: saved.name,
      periodFrom: from,
      periodTo: to,
      rowCount: built.rows.length,
      copyOverride: await emailCopyOverride("report_delivery", identity.locale),
    });
    const result = await provider.send({
      to: toEmail,
      subject: rendered.subject,
      body: rendered.text,
      html: rendered.html,
      templateKey: job.templateKey,
      orderId: null,
      attachments: [{ filename: `report-${from}-to-${to}.csv`, contentBase64: Buffer.from(csv, "utf8").toString("base64") }],
    });
    if (result.status === "failed") throw new Error("EMAIL_SEND_FAILED:provider");
    return { status: "succeeded", ref: result.messageId, detail: "scheduled report email via adapter" };
  }

  if (job.templateKey === "daily_digest") {
    // ADV-27b: team daily digest (producer: src/team/digest.ts). The
    // job carries only the recipient + `digest:<yyyy-mm-dd>` in
    // recipientRef — the digest is REBUILT from current data at send
    // time (the report_delivery ids-only pattern).
    const toEmail = (job.toEmail ?? "").trim();
    const ref = (job.recipientRef ?? "").trim();
    const ymd = ref.startsWith("digest:") ? ref.slice("digest:".length) : "";
    if (toEmail === "" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      return { status: "skipped", ref, detail: "malformed daily_digest payload" };
    }
    const { buildDailyDigest, renderDigestText } = await import("../team/digest");
    const digest = await buildDailyDigest(ymd);
    const text = renderDigestText(digest, identity.locale);
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const result = await provider.send({
      to: toEmail,
      subject: `${identity.storeName} — দৈনিক ডাইজেস্ট ${ymd}`,
      body: text,
      html: `<pre style="font-family:inherit;white-space:pre-wrap">${escaped}</pre>`,
      templateKey: job.templateKey,
      orderId: null,
    });
    if (result.status === "failed") throw new Error("EMAIL_SEND_FAILED:provider");
    return { status: "succeeded", ref: result.messageId, detail: "daily digest email via adapter" };
  }

  return {
    status: "skipped",
    ref,
    detail: `unknown email template: ${job.templateKey}`,
  };
}
