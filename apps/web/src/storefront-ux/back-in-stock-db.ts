/**
 * Back-in-stock DB store — server-only (Prisma).
 *
 * Split from back-in-stock.ts because that module is imported by the
 * client form component; this one is imported only by the public API
 * route. Same contract as InMemoryBackInStockStore, persisted to the
 * BackInStockSignup table.
 *
 * Dedupe: the schema's @@unique([productId, variantId, phone]) cannot
 * dedupe a NULL variantId (Postgres treats NULLs as distinct), so the
 * store checks first and treats a unique violation on the non-null
 * path as the duplicate it is.
 */
import { prisma } from "@advance-ecommerce/db";
import { normalizeBdPhone } from "@advance-ecommerce/validators";
import {
  backInStockSignupSchema,
  backInStockToPublic,
  type BackInStockSignupInput,
  type SignupResult,
} from "./back-in-stock";
import type { BackInStockSignup, BackInStockSignupPublic } from "./types";

interface BackInStockRow {
  productId: string;
  variantId: string | null;
  phone: string;
  createdAt: Date;
}

function rowToSignup(row: BackInStockRow): BackInStockSignup {
  return {
    productId: row.productId,
    variantId: row.variantId,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PrismaBackInStockStore {
  async add(input: BackInStockSignupInput): Promise<SignupResult> {
    const parsed = backInStockSignupSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "সঠিক তথ্য দিন।" };
    const phone = normalizeBdPhone(parsed.data.phone);
    if (!phone) return { ok: false, error: "সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।" };
    const where = {
      productId: parsed.data.productId,
      variantId: parsed.data.variantId,
      phone,
    };
    const existing = await prisma.backInStockSignup.findFirst({ where });
    if (existing) return { ok: true, signup: backInStockToPublic(rowToSignup(existing)), duplicate: true };
    try {
      const created = await prisma.backInStockSignup.create({ data: where });
      return { ok: true, signup: backInStockToPublic(rowToSignup(created)), duplicate: false };
    } catch (e) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
        const winner = await prisma.backInStockSignup.findFirst({ where });
        if (winner) return { ok: true, signup: backInStockToPublic(rowToSignup(winner)), duplicate: true };
      }
      throw e;
    }
  }

  async listForProduct(productId: string): Promise<BackInStockSignupPublic[]> {
    const rows = await prisma.backInStockSignup.findMany({
      where: { productId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => backInStockToPublic(rowToSignup(r)));
  }

  /** Raw rows for the notify job — server-side only. */
  async pendingForVariant(productId: string, variantId: string | null): Promise<BackInStockSignup[]> {
    const rows = await prisma.backInStockSignup.findMany({
      where: { productId, variantId, notifiedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToSignup);
  }
}

/** Shared DB store used by the public signup route. */
export const dbBackInStockStore = new PrismaBackInStockStore();
