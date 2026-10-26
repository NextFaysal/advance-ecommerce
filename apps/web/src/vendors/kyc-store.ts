/**
 * Vendor KYC persistence — ADV-13. Server-only.
 *
 * KYC records live as ONE zod-validated JSON document in a Setting
 * row (key `vendors.kyc_states`) — the established no-migration
 * document pattern (cf. src/reports/saved-reports.ts). Writes are
 * read-modify-write of the whole document; KYC volume is one record
 * per vendor and decisions are staff-paced, so contention is a
 * non-issue at this scale. A malformed stored document reads back
 * as empty (fail-safe: every vendor shows NOT_SUBMITTED) rather
 * than crashing a portal or admin page.
 */
import {
  defaultVendorKyc,
  vendorKycDocSchema,
  type VendorKycDoc,
  type VendorKycRecord,
} from "./kyc";

export const VENDOR_KYC_SETTING_KEY = "vendors.kyc_states";

export interface KeyValueStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string, actorId: string): Promise<void>;
}

/** Production store over the Setting table (prisma imported lazily,
 *  the saved-reports pattern). */
export function prismaKeyValueStore(): KeyValueStore {
  return {
    async read(key) {
      const { prisma } = await import("@advance-ecommerce/db");
      const row = await prisma.setting.findUnique({ where: { key } });
      return row?.value ?? null;
    },
    async write(key, value, actorId) {
      const { prisma } = await import("@advance-ecommerce/db");
      await prisma.setting.upsert({
        where: { key },
        create: {
          key,
          value,
          valueEncrypted: false,
          isPublic: false,
          category: "general",
          description: "Vendor KYC states (JSON, ADV-13)",
          updatedById: actorId,
        },
        update: { value, valueEncrypted: false, updatedById: actorId },
      });
    },
  };
}

export async function loadVendorKycDoc(
  kv: KeyValueStore = prismaKeyValueStore(),
): Promise<VendorKycDoc> {
  const raw = await kv.read(VENDOR_KYC_SETTING_KEY).catch(() => null);
  if (raw === null) return {};
  try {
    const parsed = vendorKycDocSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** One vendor's KYC record — the honest default when none exists. */
export async function getVendorKyc(
  vendorId: string,
  kv: KeyValueStore = prismaKeyValueStore(),
): Promise<VendorKycRecord> {
  const doc = await loadVendorKycDoc(kv);
  return doc[vendorId] ?? defaultVendorKyc(vendorId);
}

/** All recorded KYC states, keyed by vendorId (admin list view). */
export async function listVendorKyc(
  kv: KeyValueStore = prismaKeyValueStore(),
): Promise<VendorKycDoc> {
  return loadVendorKycDoc(kv);
}

/** Persist one vendor's record (read-modify-write of the document). */
export async function setVendorKyc(
  record: VendorKycRecord,
  actorId: string,
  kv: KeyValueStore = prismaKeyValueStore(),
): Promise<VendorKycRecord> {
  const doc = await loadVendorKycDoc(kv);
  doc[record.vendorId] = record;
  await kv.write(VENDOR_KYC_SETTING_KEY, JSON.stringify(doc), actorId);
  return record;
}
