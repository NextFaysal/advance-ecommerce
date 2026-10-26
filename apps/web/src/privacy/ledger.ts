/**
 * Privacy ledgers — durable, append-only records for ADV-29
 * (doc 22): customer data exports, account deletions/anonymisations
 * and marketing-consent changes.
 *
 * WHY Setting-docs: the staff AuditLog seam (src/lib/audit.ts
 * writeAudit) keys `actorId` to the staff `User` table by foreign
 * key, so a customer id can never be recorded as the actor (the
 * wave-40 finding: writeAudit fails silently for customer actors).
 * The export/delete services DO attempt a writeAudit row with
 * actorId: null + the customer in entityId, but the guaranteed,
 * queryable record is these ledgers — one zod-shaped JSON document
 * per ledger in a Setting row, the established machine-doc pattern
 * (src/marketing/docs.ts, src/warehouse/pick-lists.ts): the generic
 * settings API rejects unknown keys, so these docs are written
 * directly over prisma.setting with category "general".
 *
 * Keys:
 *   privacy.exports     — data-export events (newest first, cap 200)
 *   privacy.deletions   — anonymisation events (newest first, cap 200)
 *   privacy.consent_log — marketing consent granted/withdrawn
 *                         (newest first, cap 500)
 *
 * Read-modify-write on a single row: acceptable at this volume
 * (same trade-off the warehouse pick-list doc documents); entries
 * are small and appends are rare, deliberate actions.
 */
import { prisma } from "@advance-ecommerce/db";

export const PRIVACY_EXPORTS_KEY = "privacy.exports";
export const PRIVACY_DELETIONS_KEY = "privacy.deletions";
export const PRIVACY_CONSENT_LOG_KEY = "privacy.consent_log";

const CAPS: Record<string, number> = {
  [PRIVACY_EXPORTS_KEY]: 200,
  [PRIVACY_DELETIONS_KEY]: 200,
  [PRIVACY_CONSENT_LOG_KEY]: 500,
};

const DESCRIPTIONS: Record<string, string> = {
  [PRIVACY_EXPORTS_KEY]: "Privacy ledger: customer data-export events (JSON, ADV-29)",
  [PRIVACY_DELETIONS_KEY]: "Privacy ledger: account anonymisation events (JSON, ADV-29)",
  [PRIVACY_CONSENT_LOG_KEY]: "Privacy ledger: marketing consent log (JSON, ADV-29)",
};

interface LedgerDoc<T> {
  version: 1;
  entries: T[];
}

async function readLedger<T>(key: string): Promise<T[]> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    if (row === null || row.value.trim() === "") return [];
    const parsed = JSON.parse(row.value) as Partial<LedgerDoc<T>>;
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    // A corrupt/unreadable ledger degrades to empty for READS; the
    // admin privacy page then shows "no records" rather than
    // crashing. Writes re-read the same way, so a corrupt doc is
    // replaced by the next append (the corrupt value is lost —
    // acceptable next to taking customer flows down).
    return [];
  }
}

async function appendToLedger<T>(key: string, entry: T, actorId: string): Promise<void> {
  const entries = await readLedger<T>(key);
  const next = [entry, ...entries].slice(0, CAPS[key] ?? 200);
  const doc: LedgerDoc<T> = { version: 1, entries: next };
  await prisma.setting.upsert({
    where: { key },
    create: {
      key,
      value: JSON.stringify(doc),
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: DESCRIPTIONS[key] ?? "Privacy ledger (JSON, ADV-29)",
      updatedById: actorId,
    },
    update: { value: JSON.stringify(doc), valueEncrypted: false, updatedById: actorId },
  });
}

/* ------------------------------------------------------------------ */
/* Consent log                                                         */
/* ------------------------------------------------------------------ */

export interface ConsentLogEntry {
  at: string;
  action: "granted" | "withdrawn";
  /** Where the change happened: "newsletter" (footer/homepage form —
   *  the subscriber row's own source), "newsletter-unsubscribe",
   *  "account-deletion", or a future account toggle's source. */
  source: string;
  email: string | null;
  phone: string | null;
  customerId: string | null;
}

export async function recordMarketingConsent(input: {
  action: "granted" | "withdrawn";
  source: string;
  email?: string | null;
  phone?: string | null;
  customerId?: string | null;
}): Promise<void> {
  const entry: ConsentLogEntry = {
    at: new Date().toISOString(),
    action: input.action,
    source: input.source,
    email: input.email ?? null,
    phone: input.phone ?? null,
    customerId: input.customerId ?? null,
  };
  await appendToLedger(PRIVACY_CONSENT_LOG_KEY, entry, input.customerId ?? "system");
}

export async function readConsentLog(limit = 50): Promise<ConsentLogEntry[]> {
  const entries = await readLedger<ConsentLogEntry>(PRIVACY_CONSENT_LOG_KEY);
  return entries.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Export ledger                                                       */
/* ------------------------------------------------------------------ */

export interface ExportLedgerEntry {
  at: string;
  customerId: string;
  /** Section keys included in the export document. */
  sections: string[];
  /** Record count per section at export time. */
  counts: Record<string, number>;
  /** Whether the companion AuditLog row (actorId: null) was written. */
  auditLogWritten: boolean;
}

export async function recordDataExport(entry: ExportLedgerEntry): Promise<void> {
  await appendToLedger(PRIVACY_EXPORTS_KEY, entry, entry.customerId);
}

export async function readExportLedger(limit = 20): Promise<ExportLedgerEntry[]> {
  const entries = await readLedger<ExportLedgerEntry>(PRIVACY_EXPORTS_KEY);
  return entries.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Deletion ledger                                                     */
/* ------------------------------------------------------------------ */

export interface DeletionLedgerEntry {
  at: string;
  customerId: string;
  /** How the customer proved control of the account. */
  proof: "password" | "otp" | "email-confirm";
  ordersRetained: number;
  reviewsAnonymised: number;
  questionsAnonymised: number;
  addressesDeleted: number;
  sessionsDeleted: number;
  cartsDeleted: number;
  pushSubscriptionsDeleted: number;
  abandonedCheckoutsDeleted: number;
  newsletterUnsubscribed: boolean;
  /** Whether the companion AuditLog row (actorId: null) was written. */
  auditLogWritten: boolean;
}

export async function recordAccountDeletion(entry: DeletionLedgerEntry): Promise<void> {
  await appendToLedger(PRIVACY_DELETIONS_KEY, entry, entry.customerId);
}

export async function readDeletionLedger(limit = 20): Promise<DeletionLedgerEntry[]> {
  const entries = await readLedger<DeletionLedgerEntry>(PRIVACY_DELETIONS_KEY);
  return entries.slice(0, limit);
}
