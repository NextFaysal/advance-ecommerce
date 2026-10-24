/**
 * Demo audit-log store — Agent 39.
 *
 * In-memory stand-in for the AuditLog table behind the staff / audit-log /
 * feature-flags APIs. Entries are shaped exactly like the records
 * src/lib/audit.ts writes (AuditInput + id/createdAt) and are sanitized the
 * same way (secret-like keys become "[REDACTED]"). The sanitize/sensitive
 * helpers are mirrored locally on purpose: src/lib/audit.ts statically
 * imports the (not yet generated) Prisma client, and these routes must stay
 * loadable — and fail-closed via the guard — while Prisma is pending.
 *
 * Seed rows are FICTIONAL (demo-labelled actors/entities, no real log data).
 * Real wiring (later): getAuditLogs()/writeAudit() in src/lib/audit.ts over
 * the AuditLog table; this store is deleted, the route contracts stay.
 */

export interface DemoAuditEntry {
  id: string;
  actorId: string | null;
  /** Display-only label for the actor (demo seed rows are fictional). */
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string; // ISO 8601
}

/** Mirror of SENSITIVE_ACTIONS in src/lib/audit.ts — these require a reason. */
export const DEMO_SENSITIVE_ACTIONS: ReadonlySet<string> = new Set([
  "orders.delete",
  "orders.refund",
  "payments.refund",
  "products.delete",
  "products.price_change",
  "customers.view_full_phone",
  "customers.export",
  "orders.export",
  "settings.update",
  "staff.manage",
  "roles.manage",
  "feature_flags.manage",
]);

const SECRET_KEY_PATTERN = /(password|secret|token|api_key|apikey|private_key|client_secret|access_key|totp|otp|code)/i;

/** Mirror of sanitizeAuditJson() in src/lib/audit.ts. */
export function sanitizeDemoAuditJson(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (value === null) return null;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : val;
  }
  return out;
}

let sequence = 0;

export const demoAuditStore: DemoAuditEntry[] = [
  {
    id: "aud_sample_01",
    actorId: "staff_sample_manager",
    actorLabel: "SAMPLE ম্যানেজার",
    action: "orders.update_status",
    entityType: "Order",
    entityId: "ord_sample_100245",
    beforeJson: { status: "PENDING" },
    afterJson: { status: "CONFIRMED" },
    reason: null,
    ip: null,
    userAgent: null,
    createdAt: "2026-10-24T05:42:00.000Z",
  },
  {
    id: "aud_sample_02",
    actorId: "staff_sample_manager",
    actorLabel: "SAMPLE ম্যানেজার",
    action: "customers.view_full_phone",
    entityType: "Customer",
    entityId: "cus_sample_0091",
    beforeJson: null,
    afterJson: null,
    reason: "কুরিয়ার ডেলিভারি সমস্যায় গ্রাহককে কল করা দরকার ছিল",
    ip: null,
    userAgent: null,
    createdAt: "2026-10-24T05:35:00.000Z",
  },
  {
    id: "aud_sample_03",
    actorId: "staff_sample_owner",
    actorLabel: "SAMPLE মালিক",
    action: "products.price_change",
    entityType: "Product",
    entityId: "prd_sample_0312",
    beforeJson: { pricePoisha: 550000 },
    afterJson: { pricePoisha: 450000 },
    reason: "অফার ক্যাম্পেইনের জন্য দাম হালনাগাদ",
    ip: null,
    userAgent: null,
    createdAt: "2026-10-24T04:18:00.000Z",
  },
  {
    id: "aud_sample_04",
    actorId: "staff_sample_accountant",
    actorLabel: "SAMPLE হিসাবরক্ষক",
    action: "payments.refund",
    entityType: "Payment",
    entityId: "pay_sample_7781",
    beforeJson: { status: "PAID" },
    afterJson: { status: "REFUNDED" },
    reason: "ডুপ্লিকেট পেমেন্ট — গ্রাহকের অনুরোধে রিফান্ড",
    ip: null,
    userAgent: null,
    createdAt: "2026-10-24T03:57:00.000Z",
  },
  {
    id: "aud_sample_05",
    actorId: "staff_sample_manager",
    actorLabel: "SAMPLE ম্যানেজার",
    action: "products.create",
    entityType: "Product",
    entityId: "prd_sample_0313",
    beforeJson: null,
    afterJson: { status: "DRAFT" },
    reason: null,
    ip: null,
    userAgent: null,
    createdAt: "2026-10-23T11:20:00.000Z",
  },
  {
    id: "aud_sample_06",
    actorId: "staff_sample_owner",
    actorLabel: "SAMPLE মালিক",
    action: "settings.update",
    entityType: "Setting",
    entityId: "payment.bkash.enabled",
    beforeJson: { changed: false },
    afterJson: { changed: true },
    reason: "bKash মার্চেন্ট অ্যাকাউন্ট যাচাই শেষে চালু করা হলো",
    ip: null,
    userAgent: null,
    createdAt: "2026-10-23T09:09:00.000Z",
  },
  {
    id: "aud_sample_07",
    actorId: "staff_sample_owner",
    actorLabel: "SAMPLE মালিক",
    action: "orders.export",
    entityType: "Order",
    entityId: "export_sample_0042",
    beforeJson: null,
    afterJson: null,
    reason: "মাসিক হিসাব মেলানোর জন্য এক্সপোর্ট",
    ip: null,
    userAgent: null,
    createdAt: "2026-10-23T06:30:00.000Z",
  },
  {
    id: "aud_sample_08",
    actorId: "staff_sample_owner",
    actorLabel: "SAMPLE মালিক",
    action: "feature_flags.manage",
    entityType: "FeatureFlag",
    entityId: "module.reseller",
    beforeJson: { enabled: false },
    afterJson: { enabled: false },
    reason: "ডেমো যাচাই — কোনো পরিবর্তন কার্যকর হয়নি",
    ip: null,
    userAgent: null,
    createdAt: "2026-10-23T05:12:00.000Z",
  },
];

export interface RecordDemoAuditInput {
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Append an entry to the demo store. Mirrors writeAudit()'s rule: sensitive
 * actions require a non-empty reason — throws if it is missing, so callers
 * must validate first (routes do, via Zod). Snapshots are sanitized.
 */
export function recordDemoAudit(input: RecordDemoAuditInput): DemoAuditEntry {
  if (DEMO_SENSITIVE_ACTIONS.has(input.action)) {
    if (input.reason === undefined || input.reason === null || input.reason.trim() === "") {
      throw new Error(`Audit reason is required for sensitive action: ${input.action}`);
    }
  }
  sequence += 1;
  const entry: DemoAuditEntry = {
    id: `aud_demo_${Date.now()}_${sequence}`,
    actorId: input.actorId ?? null,
    actorLabel: input.actorLabel ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    beforeJson: sanitizeDemoAuditJson(input.beforeJson ?? null),
    afterJson: sanitizeDemoAuditJson(input.afterJson ?? null),
    reason: input.reason ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    createdAt: new Date().toISOString(),
  };
  demoAuditStore.unshift(entry);
  return entry;
}

export interface AuditFilters {
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string; // ISO date/datetime, inclusive
  to?: string; // ISO date/datetime, inclusive
}

/** Newest-first filtered view over the demo store. */
export function filterDemoAuditEntries(filters: AuditFilters): DemoAuditEntry[] {
  const actor = filters.actor?.toLowerCase();
  const fromMs = filters.from ? Date.parse(filters.from) : Number.NaN;
  const toMs = filters.to ? Date.parse(filters.to) : Number.NaN;
  return demoAuditStore.filter((e) => {
    if (actor) {
      const hay = `${e.actorId ?? ""} ${e.actorLabel ?? ""}`.toLowerCase();
      if (!hay.includes(actor)) return false;
    }
    if (filters.action && e.action !== filters.action) return false;
    if (filters.entityType && e.entityType !== filters.entityType) return false;
    if (filters.entityId && e.entityId !== filters.entityId) return false;
    const ms = Date.parse(e.createdAt);
    if (!Number.isNaN(fromMs) && ms < fromMs) return false;
    if (!Number.isNaN(toMs) && ms > toMs) return false;
    return true;
  });
}
