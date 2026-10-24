/**
 * Queue runner executors — the five HandlerDeps runners that
 * worker-deps.ts previously had to omit (handlers reported
 * "skipped — not configured" for their queues):
 *
 *  - webhookFanout           -> "webhook-delivery" queue
 *  - reportRunner            -> "report-generation" queue
 *  - automationRunner        -> "automation-run" queue
 *  - importExportRunner      -> "import-export" queue
 *  - notificationRetryRunner -> "notification-retry" queue
 *
 * Every runner is a thin executor over the EXISTING service layer —
 * no business logic is re-implemented here:
 *  - Webhooks: subscriptions come from the Prisma-backed
 *    webhookSubscriptionStore (src/extensibility/db-store.ts); signing
 *    and result classification come from src/extensibility/webhooks.ts
 *    (signWebhookPayload / webhookHeaders / nextDeliveryStatus).
 *  - Reports: rows from src/reports/db-rows.ts fetchSalesRows(),
 *    aggregation from src/reports/service.ts aggregateSales().
 *  - Automation: rules + run logs through the DB-backed
 *    automationStore (src/automation/store.ts), evaluation through
 *    runRule() (src/automation/engine.ts). Effects stay DESCRIBED in
 *    the persisted run log — the engine's contract — exactly as the
 *    admin runs route behaves today.
 *  - Import/export: previewImport / parseCsv / groupImportRowsByProduct
 *    (src/catalog/import.ts) and the Prisma CatalogRepository
 *    (src/catalog/service.ts) — the same services the admin import
 *    route and products API use.
 *  - Notification retry: rows from the NotificationLog table, re-driven
 *    through the worker's configured (sandbox) SMS/email resolvers.
 *
 * Payload discipline: job payloads are validated with Zod before any
 * work; a malformed job throws INVALID_JOB:<queue> so BullMQ retries
 * per the queue policy and dead-letters it — no crash loop, no
 * phantom success. Log lines carry ids / refs / counts only — never a
 * phone number, email address, message body, or credential.
 *
 * Known storage gaps (documented, NOT papered over):
 *  - Webhook DELIVERY logs have no DB table (see
 *    src/extensibility/store.ts). Attempts are recorded in the
 *    in-memory store below — the same local-dev pattern as
 *    InMemoryIdempotencyStore / InMemoryDeadLetterSink in
 *    handlers.ts — and mirrored to the worker log. A
 *    WebhookDeliveryLog table is the follow-up when the schema grows
 *    one; the records kept here already match that type exactly.
 *  - Reports have no result/file store. The report runner returns a
 *    computed-summary ref (type, Dhaka range, order count, poisha
 *    totals) — never a fabricated file path or download.
 *  - Import/export files: no object storage exists in this codebase,
 *    so a job's fileRef is a plain file NAME resolved inside one
 *    local directory (env AE_JOB_FILES_DIR, default ./job-files
 *    under the worker's cwd). Absolute paths and ".." are rejected.
 *    When real storage (R2) lands, only resolveJobFile() changes.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import {
  DOMAIN_EVENTS,
  type DomainEvent,
  type WebhookDeliveryLog,
  type WebhookSubscription,
} from "../extensibility/types";
import { webhookSubscriptionStore } from "../extensibility/db-store";
import {
  emptyDeliveryLog,
  nextDeliveryStatus,
  signWebhookPayload,
  webhookHeaders,
} from "../extensibility/webhooks";
import type { WebhookJob } from "./queues";
import type {
  AutomationJob,
  ImportExportJob,
  JobLogger,
  NotificationRetryJob,
  ReportJob,
} from "./handlers";
import type { EmailProvider } from "../integrations/email";
import type { SmsProvider } from "../integrations/sms";
import { aggregateSales } from "../reports/service";
import { dhakaDateOf, fetchSalesRows, withComparisonWindow } from "../reports/db-rows";
import { dateRangeSchema } from "../reports/types";
import { runRule } from "../automation/engine";
import { automationStore } from "../automation/store";
import {
  AUTOMATION_TRIGGERS,
  type AutomationEvent,
  type AutomationTrigger,
} from "../automation/types";
import { getOrderByIdOrNo } from "../orders/repository";
import {
  DbNotReadyError,
  PrismaCatalogRepository,
  hasPrismaCatalog,
  productInputSchema,
  type CatalogRepository,
  type ProductInput,
} from "../catalog/service";
import {
  IMPORT_HEADERS,
  groupImportRowsByProduct,
  parseCsv,
  previewImport,
  type ImportRow,
} from "../catalog/import";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** First token of an error message — an error CODE, never payload data. */
function errorCodeOf(error: unknown): string {
  if (error instanceof Error) {
    const firstToken = error.message.split(":")[0]?.trim();
    return firstToken !== undefined && firstToken !== "" ? firstToken : error.name;
  }
  return "UNKNOWN_ERROR";
}

function invalidJob(queue: string): Error {
  return new Error(`INVALID_JOB:${queue}`);
}

/* ================================================================== */
/* Webhook fanout                                                      */
/* ================================================================== */

const webhookJobSchema = z.object({
  event: z.enum(DOMAIN_EVENTS),
  payloadId: z.string().min(1),
});

/**
 * In-memory webhook delivery-log store (see the header: no DB table
 * exists yet). One record per (subscription, payloadId); attempts
 * accumulate across BullMQ retries of the same job, and the status
 * machine is the module's own nextDeliveryStatus().
 */
const deliveryLogs = new Map<string, WebhookDeliveryLog>();

export function listWebhookDeliveryLogs(): WebhookDeliveryLog[] {
  return [...deliveryLogs.values()].map((log) => ({ ...log }));
}

export interface WebhookFanoutDeps {
  /** Settings lookup (worker-deps' fail-soft resolver). Used only for
   *  per-subscription signing secrets: key `webhook.secret.<id>`. */
  readSetting: (key: string) => Promise<string | null>;
  logger?: JobLogger;
}

/** Entity type segment of a domain event ("order.created" -> "order"). */
function entityTypeOf(event: DomainEvent): string {
  return event.split(".")[0] ?? "event";
}

type DeliveryOutcome = "delivered" | "retrying" | "terminal";

async function deliverOnce(
  deps: WebhookFanoutDeps,
  sub: WebhookSubscription,
  event: DomainEvent,
  payloadId: string,
  body: string,
): Promise<DeliveryOutcome> {
  const key = `${sub.id}:${payloadId}`;
  let log = deliveryLogs.get(key);
  if (log === undefined) {
    log = emptyDeliveryLog(`whd:${sub.id}:${payloadId}`, sub.id, event, payloadId, new Date());
    deliveryLogs.set(key, log);
  }
  // A delivery that already reached a terminal state (delivered /
  // failed / dead) is never re-attempted for the same payload.
  if (log.status === "delivered") return "delivered";
  if (log.status === "failed" || log.status === "dead") return "terminal";

  const attempt = log.attempts + 1;
  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-ae-event": event,
    "x-ae-timestamp": timestamp,
  };
  if (sub.hasSecret) {
    // The secret lives encrypted in Admin Settings (extensibility
    // types contract); only its resolved value is used, in-process,
    // to sign — it is never logged or stored here.
    const secret = await deps.readSetting(`webhook.secret.${sub.id}`);
    if (secret === null || secret === "") {
      // Never send an unsigned payload to an endpoint that expects
      // signing. Terminal for this endpoint: a retry cannot conjure
      // the missing secret, staff must configure it.
      log.attempts = attempt;
      log.httpStatus = null;
      log.status = "failed";
      log.lastError = "signing_secret_unavailable";
      deps.logger?.warn("webhook.delivery.no_secret", {
        subscriptionId: sub.id,
        event,
        payloadId,
      });
      return "terminal";
    }
    Object.assign(headers, webhookHeaders(signWebhookPayload(secret, timestamp, body), timestamp, event));
  }

  let httpStatus: number | null = null;
  let networkError: string | null = null;
  try {
    const response = await fetch(sub.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = response.status;
    // Drain the body so the socket is released; the body is never
    // stored or logged (webhooks.ts contract).
    await response.text().catch(() => "");
  } catch (error) {
    networkError = error instanceof Error ? error.name : "network_error";
  }

  const status = nextDeliveryStatus(httpStatus, attempt);
  log.attempts = attempt;
  log.httpStatus = httpStatus;
  log.status = status;
  log.lastError =
    status === "delivered" ? null : (networkError ?? `http_${httpStatus ?? "none"}`);
  if (status === "delivered") log.deliveredAt = new Date().toISOString();
  deps.logger?.info("webhook.delivery.attempt", {
    subscriptionId: sub.id,
    event,
    payloadId,
    attempt,
    httpStatus: httpStatus ?? "none",
    status,
  });
  if (status === "delivered") return "delivered";
  if (status === "retrying") return "retrying";
  return "terminal";
}

/**
 * Fan a domain event out to every enabled subscription registered for
 * it. If any delivery classifies "retrying", the runner throws so
 * BullMQ applies the webhook queue's DEFAULT_RETRY backoff; a
 * delivery that exhausts the policy is marked "dead" by
 * nextDeliveryStatus() and no longer blocks the job.
 */
export function createWebhookFanout(
  deps: WebhookFanoutDeps,
): (job: WebhookJob) => Promise<{ deliveredToRef: string }> {
  return async (job) => {
    const parsed = webhookJobSchema.safeParse(job);
    if (!parsed.success) throw invalidJob("webhook");
    const { event, payloadId } = parsed.data;

    const subscriptions = await webhookSubscriptionStore.listForEvent(event);
    if (subscriptions.length === 0) {
      // Nothing is subscribed to this event: fan-out to zero endpoints
      // is a completed job, not a skip — this runner IS configured.
      return { deliveredToRef: `wh:${payloadId}:0/0` };
    }

    // IDs-and-refs-only payload, the HookEventPayload discipline from
    // src/extensibility/types.ts. Built once per job; each attempt
    // signs the exact bytes it sends.
    const body = JSON.stringify({
      event,
      entityType: entityTypeOf(event),
      entityId: payloadId,
      occurredAt: new Date().toISOString(),
      data: {},
    });

    let delivered = 0;
    let retrying = 0;
    for (const sub of subscriptions) {
      const outcome = await deliverOnce(deps, sub, event, payloadId, body);
      if (outcome === "delivered") delivered += 1;
      if (outcome === "retrying") retrying += 1;
    }
    if (retrying > 0) {
      throw new Error(`WEBHOOK_DELIVERY_PENDING:${payloadId}:${retrying}`);
    }
    return { deliveredToRef: `wh:${payloadId}:${delivered}/${subscriptions.length}` };
  };
}

/* ================================================================== */
/* Report runner                                                       */
/* ================================================================== */

const reportJobSchema = z.object({
  reportType: z.enum(["sales", "product", "customer", "courier", "district", "pnl"]),
  requestedByRef: z.string().min(1),
  rangeStart: z.string().min(1),
  rangeEnd: z.string().min(1),
});

export interface ReportRunnerDeps {
  logger?: JobLogger;
}

/**
 * Runs the requested report over real DB rows through the reports
 * service and returns a computed-summary ref. There is deliberately
 * no fileRef pointing at a file: the reports module has no result
 * store, so the summary IS the result (the CSV the admin export route
 * streams is rendered from this same bundle on demand).
 */
export function createReportRunner(
  deps: ReportRunnerDeps,
): (job: ReportJob) => Promise<{ fileRef: string }> {
  return async (job) => {
    const parsed = reportJobSchema.safeParse(job);
    if (!parsed.success) throw invalidJob("report");
    const start = new Date(parsed.data.rangeStart);
    const end = new Date(parsed.data.rangeEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw invalidJob("report:range");
    }
    // Job ranges are instants; report ranges are Asia/Dhaka calendar
    // dates (reports/db-rows.ts contract).
    const rangeParsed = dateRangeSchema.safeParse({
      from: dhakaDateOf(start),
      to: dhakaDateOf(end),
    });
    if (!rangeParsed.success) throw invalidJob("report:range");
    const range = rangeParsed.data;

    const rows = await fetchSalesRows(withComparisonWindow(range));
    const bundle = aggregateSales(rows, range, true);
    const totals = bundle.totals;
    const bucketByType = {
      product: bundle.byProduct,
      customer: bundle.byCustomer,
      courier: bundle.byCourier,
      district: bundle.byDistrict,
    } as const;
    const bucketCount =
      parsed.data.reportType in bucketByType
        ? Object.keys(bucketByType[parsed.data.reportType as keyof typeof bucketByType]).length
        : 0;
    deps.logger?.info("report.computed", {
      reportType: parsed.data.reportType,
      requestedByRef: parsed.data.requestedByRef,
      from: range.from,
      to: range.to,
      orders: totals.orders,
      revenuePoisha: totals.revenuePoisha,
      grossProfitPoisha: totals.grossProfitPoisha,
    });
    const summary =
      `report:${parsed.data.reportType}:${range.from}..${range.to}` +
      `:orders=${totals.orders}:revenuePoisha=${totals.revenuePoisha}` +
      `:grossProfitPoisha=${totals.grossProfitPoisha}`;
    return { fileRef: bucketCount > 0 ? `${summary}:buckets=${bucketCount}` : summary };
  };
}

/* ================================================================== */
/* Automation runner                                                   */
/* ================================================================== */

const automationJobSchema = z.object({
  workflowId: z.string().min(1),
  triggerEvent: z.enum(AUTOMATION_TRIGGERS),
  entityId: z.string().min(1),
  dryRun: z.boolean().optional(),
});

/**
 * The dispatch the engine deliberately does not own: map
 * (triggerEvent, entityId) to the AutomationEvent the engine
 * evaluates, loading the entity from the service layer / DB.
 * entityId is an order id or orderNo for order/payment triggers, a
 * variant id for stock.low, and a cart id for checkout.abandoned.
 */
async function buildAutomationEvent(
  trigger: AutomationTrigger,
  entityId: string,
): Promise<AutomationEvent> {
  const occurredAt = new Date().toISOString();
  switch (trigger) {
    case "order.created":
    case "order.status_changed":
    case "payment.succeeded": {
      const order = await getOrderByIdOrNo(entityId);
      if (order === null) throw new Error(`ENTITY_NOT_FOUND:order:${entityId}`);
      const event: AutomationEvent = {
        type: trigger,
        occurredAt,
        order: {
          id: order.id,
          orderNo: order.orderNo,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          totalPoisha: order.totalPoisha,
          itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
          customerPhone: order.customerPhone,
          district: order.address.district,
          division: order.address.division,
          ...(order.courier ? { courier: order.courier } : {}),
          riskScore: order.riskScore,
          tags: order.tags,
        },
      };
      if (trigger === "payment.succeeded") {
        // The succeeded amount comes from the Payment row itself —
        // never assumed from the order total. No PAID payment, no
        // payment block: conditions on paymentAmountPoisha then
        // honestly evaluate as not-exists.
        const payment = await prisma.payment.findFirst({
          where: { orderId: order.id, status: "PAID" },
          orderBy: { createdAt: "desc" },
        });
        if (payment !== null) {
          event.payment = {
            amountPoisha: payment.paidPoisha > 0 ? payment.paidPoisha : payment.amountPoisha,
            method: String(payment.method).toLowerCase(),
          };
        }
      }
      return event;
    }
    case "stock.low": {
      const variant = await prisma.productVariant.findUnique({
        where: { id: entityId },
        include: { inventoryItems: true },
      });
      if (variant === null) throw new Error(`ENTITY_NOT_FOUND:variant:${entityId}`);
      const available =
        variant.inventoryItems.length > 0
          ? variant.inventoryItems.reduce(
              (sum, item) => sum + (item.quantityOnHand - item.quantityReserved),
              0,
            )
          : variant.stock;
      return {
        type: trigger,
        occurredAt,
        stock: { variantId: variant.id, sku: variant.sku, available },
      };
    }
    case "checkout.abandoned": {
      const cart = await prisma.cart.findUnique({
        where: { id: entityId },
        include: { items: true },
      });
      if (cart === null) throw new Error(`ENTITY_NOT_FOUND:cart:${entityId}`);
      return {
        type: trigger,
        occurredAt,
        checkout: {
          id: cart.id,
          totalPoisha: cart.items.reduce(
            (sum, item) => sum + item.unitPricePoisha * item.quantity,
            0,
          ),
          abandonedMinutes: Math.max(
            0,
            Math.floor((Date.now() - cart.updatedAt.getTime()) / 60_000),
          ),
        },
      };
    }
  }
}

/**
 * Executes one queued automation job: workflowId is the AutomationRule
 * id (rules are the workflows of this module — the admin automation
 * API manages them). The rule is loaded from the DB store, the event
 * is built from the entity, the engine evaluates, and the run log is
 * persisted through the store — except for dry-run jobs, which are
 * evaluated but NEVER persisted (the engine's dry-run contract).
 * Effects remain described in the run log; executing them belongs to
 * the downstream queues, exactly as the admin runs route behaves.
 */
export function createAutomationRunner(): (
  job: AutomationJob,
) => Promise<{ ruleRef: string }> {
  return async (job) => {
    const parsed = automationJobSchema.safeParse(job);
    if (!parsed.success) throw invalidJob("automation");
    const { workflowId, triggerEvent, entityId } = parsed.data;

    const rule = await automationStore.getRule(workflowId);
    if (rule === undefined) {
      // Same precedent as the bulk-actions runner: an id this system
      // has never seen fails loudly (retry / dead-letter), it never
      // reports a phantom success.
      throw new Error(`AUTOMATION_RULE_NOT_FOUND:${workflowId}`);
    }
    const event = await buildAutomationEvent(triggerEvent, entityId);
    const log = runRule(rule, event, {
      dryRun: parsed.data.dryRun === true,
      runId: `run_${randomUUID()}`,
    });
    if (parsed.data.dryRun !== true) {
      await automationStore.appendRun(log);
    }
    return { ruleRef: rule.id };
  };
}

/* ================================================================== */
/* Import / export runner                                              */
/* ================================================================== */

const importExportJobSchema = z.object({
  kind: z.enum(["import", "export"]),
  entity: z.enum(["products", "orders", "customers"]),
  fileRef: z.string().min(1).max(200),
  requestedByRef: z.string().min(1),
});

/** Local job-files directory — see the header for the storage story. */
function jobFilesDir(): string {
  return process.env.AE_JOB_FILES_DIR ?? path.join(process.cwd(), "job-files");
}

/** Resolve a job fileRef to a path that cannot escape the directory. */
function resolveJobFile(fileRef: string): string {
  if (
    path.isAbsolute(fileRef) ||
    fileRef.includes("\\") ||
    fileRef.split("/").includes("..")
  ) {
    throw invalidJob("import-export:fileRef");
  }
  const dir = path.resolve(jobFilesDir());
  const resolved = path.resolve(dir, fileRef);
  if (!resolved.startsWith(dir + path.sep)) {
    throw invalidJob("import-export:fileRef");
  }
  return resolved;
}

function catalogRepository(): CatalogRepository {
  if (!hasPrismaCatalog(prisma)) {
    throw new DbNotReadyError(
      "Catalog database is not available: the Prisma client has no catalog models.",
    );
  }
  return new PrismaCatalogRepository(prisma);
}

/** requestedByRef becomes the stock-ledger actor only when it is a
 *  real User id (mirrors resolveUserId in src/orders/repository.ts). */
async function resolveActorId(ref: string): Promise<string | null> {
  if (ref === "") return null;
  const user = await prisma.user.findUnique({ where: { id: ref }, select: { id: true } });
  return user?.id ?? null;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function importProducts(job: ImportExportJob): Promise<{ processedRef: string }> {
  const repo = catalogRepository();
  const filePath = resolveJobFile(job.fileRef);
  let csv: string;
  try {
    csv = await readFile(filePath, "utf8");
  } catch {
    throw new Error(`JOB_FILE_NOT_FOUND:${job.fileRef}`);
  }
  // Duplicate-SKU classification needs the SKUs already in the
  // catalog: collect the file's SKUs and ask the repository which
  // exist (previewImport never invents this itself).
  const fileSkus = [
    ...new Set(
      parseCsv(csv)
        .rows.map((row) => (row.sku ?? "").trim())
        .filter((sku) => sku !== ""),
    ),
  ];
  const preview = previewImport(csv, new Set(await repo.skusExist(fileSkus)));

  if (preview.invalidRows.length > 0) {
    // All-or-nothing for an unattended job: nothing is created, and
    // NO row is silently dropped — every invalid row lands in the
    // error-report CSV next to the source file, and the counts are
    // in the result ref. (The interactive route is preview-then-
    // confirm; a queue job has no human to confirm a partial file.)
    const errorRef = `${job.fileRef}.errors.csv`;
    await mkdir(path.dirname(resolveJobFile(errorRef)), { recursive: true });
    await writeFile(resolveJobFile(errorRef), `${preview.errorReportCsv}\n`, "utf8");
    return {
      processedRef:
        `import:products:rejected:total=${preview.totalRows}` +
        `:valid=${preview.validRows.length}:invalid=${preview.invalidRows.length}` +
        `:errors=${errorRef}`,
    };
  }

  const grouped = groupImportRowsByProduct(preview.validRows);
  const actorId = await resolveActorId(job.requestedByRef);
  let variantCount = 0;
  for (const rowsForProduct of Object.values(grouped)) {
    const first = rowsForProduct[0] as ImportRow;
    const tags = [
      ...new Set(
        rowsForProduct.flatMap((row) =>
          (row.tags ?? "").split("|").map((tag) => tag.trim()).filter((tag) => tag !== ""),
        ),
      ),
    ];
    const input: ProductInput = productInputSchema.parse({
      slug: first.slug,
      titleBn: first.title_bn,
      titleEn: first.title_en,
      descriptionBn: first.description_bn,
      descriptionEn: first.description_en,
      categorySlug: first.category_slug,
      brandName: first.brand_name ?? null,
      status: first.status,
      tags,
      images: [],
      variants: rowsForProduct.map((row) => ({
        attributes: {},
        sku: row.sku,
        pricePoisha: row.price_poisha,
        compareAtPoisha: row.compare_at_poisha ?? null,
        costPoisha: row.cost_poisha ?? null,
        stock: row.stock,
        // An empty CSV cell means "no image": the product input
        // schema requires a real URL or null, never "".
        imageUrl: row.image_url ? row.image_url : null,
        isActive: true,
      })),
    });
    await repo.createProduct(input, actorId);
    variantCount += rowsForProduct.length;
  }
  return {
    processedRef: `import:products:created=${Object.keys(grouped).length}:variants=${variantCount}`,
  };
}

async function exportProducts(job: ImportExportJob): Promise<{ processedRef: string }> {
  const repo = catalogRepository();
  const pageSize = 200;
  const products: Awaited<ReturnType<CatalogRepository["listProducts"]>>["products"] = [];
  let page = 1;
  for (;;) {
    const batch = await repo.listProducts({ status: "ALL", page, pageSize });
    products.push(...batch.products);
    if (products.length >= batch.total || batch.products.length === 0) break;
    page += 1;
  }
  // Export uses the import format (IMPORT_HEADERS), so an export can
  // be re-imported as-is — the round-trip is the module's contract.
  const lines: string[] = [IMPORT_HEADERS.join(",")];
  let rowCount = 0;
  for (const product of products) {
    for (const variant of product.variants) {
      lines.push(
        [
          csvCell(product.slug),
          csvCell(product.title.bn),
          csvCell(product.title.en),
          csvCell(product.description.bn),
          csvCell(product.description.en),
          csvCell(product.categorySlug),
          csvCell(product.brandName),
          csvCell(product.status),
          csvCell(product.tags.join("|")),
          csvCell(variant.sku),
          csvCell(variant.pricePoisha),
          csvCell(variant.compareAtPoisha),
          csvCell(variant.costPoisha),
          csvCell(variant.stock),
          csvCell(variant.imageUrl ?? product.images[0]?.url ?? null),
        ].join(","),
      );
      rowCount += 1;
    }
  }
  const filePath = resolveJobFile(job.fileRef);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return { processedRef: `export:products:rows=${rowCount}:file=${job.fileRef}` };
}

/**
 * Catalog import/export jobs, executed through the catalog services.
 * Orders/customers have no import/export service in this codebase, so
 * those jobs fail cleanly with UNSUPPORTED_ENTITY instead of being
 * fake-processed.
 */
export function createImportExportRunner(): (
  job: ImportExportJob,
) => Promise<{ processedRef: string }> {
  return async (job) => {
    const parsed = importExportJobSchema.safeParse(job);
    if (!parsed.success) throw invalidJob("import-export");
    if (parsed.data.entity !== "products") {
      throw new Error(`UNSUPPORTED_ENTITY:${parsed.data.entity}`);
    }
    return parsed.data.kind === "import" ? importProducts(job) : exportProducts(job);
  };
}

/* ================================================================== */
/* Notification retry runner                                           */
/* ================================================================== */

const notificationRetryJobSchema = z.object({
  notificationLogId: z.string().min(1),
  channel: z.enum(["sms", "email", "in_app"]),
});

export interface NotificationRetryRunnerDeps {
  /** The worker's configured-provider resolvers (worker-deps). */
  smsProvider?: (providerName: string | null) => Promise<SmsProvider>;
  emailProvider?: (providerName: string | null) => Promise<EmailProvider>;
  logger?: JobLogger;
}

/**
 * Re-drives a FAILED NotificationLog record through the configured
 * channel. Retry limits are the notification-retry queue's own
 * policy (DEFAULT_RETRY — 3 attempts, 30 s backoff — enforced by
 * BullMQ): each failed re-drive throws, and the final failure
 * dead-letters while the record stays FAILED with errorRef stamped.
 *
 * Truthful end states only: the configured adapters are sandbox
 * adapters whose sends are simulated `queued`, so a successful
 * re-drive returns the record to QUEUED with the provider name
 * stamped — never SENT. (The NotificationLog schema has no attempt
 * counter column, so per-record attempt counting lives in the queue
 * layer, not on the row.)
 */
export function createNotificationRetryRunner(
  deps: NotificationRetryRunnerDeps,
): (job: NotificationRetryJob) => Promise<{ ref: string }> {
  return async (job) => {
    const parsed = notificationRetryJobSchema.safeParse(job);
    if (!parsed.success) throw invalidJob("notification-retry");

    const record = await prisma.notificationLog.findUnique({
      where: { id: parsed.data.notificationLogId },
    });
    if (record === null) {
      throw new Error(`NOTIFICATION_NOT_FOUND:${parsed.data.notificationLogId}`);
    }
    if (record.status !== "FAILED") {
      // QUEUED is already pending a (simulated) send and SENT is
      // terminal: neither has anything truthful to re-drive.
      return { ref: record.id };
    }

    try {
      // The record's channel is authoritative; the job's channel is
      // the routing hint the producer enqueued with.
      if (record.channel === "SMS") {
        if (deps.smsProvider === undefined) {
          throw new Error("RETRY_PROVIDER_UNCONFIGURED:sms");
        }
        const provider = await deps.smsProvider(null);
        const result = await provider.send({
          toPhone: record.recipientRef,
          message: "",
          templateKey: record.templateKey,
          orderId: record.orderId,
        });
        if (result.status !== "queued") {
          throw new Error(`PROVIDER_FAILED:sms:${result.status}`);
        }
        await prisma.notificationLog.update({
          where: { id: record.id },
          data: {
            status: "QUEUED",
            provider: provider.name,
            segments: String(result.segments),
            errorRef: null,
          },
        });
      } else if (record.channel === "EMAIL") {
        if (deps.emailProvider === undefined) {
          throw new Error("RETRY_PROVIDER_UNCONFIGURED:email");
        }
        const provider = await deps.emailProvider(null);
        const result = await provider.send({
          to: record.recipientRef,
          subject: "",
          body: "",
          templateKey: record.templateKey,
          orderId: record.orderId,
        });
        if (result.status !== "queued") {
          throw new Error(`PROVIDER_FAILED:email:${result.status}`);
        }
        await prisma.notificationLog.update({
          where: { id: record.id },
          data: { status: "QUEUED", provider: provider.name, errorRef: null },
        });
      } else {
        // IN_APP: the record IS the notification (the client reads it
        // from the DB) — re-driving is returning it to QUEUED.
        await prisma.notificationLog.update({
          where: { id: record.id },
          data: { status: "QUEUED", errorRef: null },
        });
      }
    } catch (error) {
      // Stamp the failure code on the record (ids/codes only) and let
      // the job fail: BullMQ applies the queue retry policy, and the
      // final attempt dead-letters with the record still FAILED.
      await prisma.notificationLog
        .update({ where: { id: record.id }, data: { errorRef: errorCodeOf(error) } })
        .catch(() => undefined);
      throw error;
    }
    deps.logger?.info("notification.retry.redriven", {
      notificationLogId: record.id,
      channel: record.channel,
      status: "QUEUED",
    });
    return { ref: record.id };
  };
}
