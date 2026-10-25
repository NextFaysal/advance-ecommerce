/**
 * POS sales in the order world (doc 17, batch O9-2) — a READ view for
 * the orders team over the counter's PosSale rows (src/pos), which
 * otherwise live in their own silo.
 *
 * This deliberately does NOT turn POS sales into Orders: a PosSale's
 * stock already moved inside the POS flow (src/pos/store applies the
 * same reservation-ledger effects at sale time), so converting a
 * sale into an Order here would double-count stock and revenue. The
 * orders page panel says so in its copy; this service only reads.
 *
 * Range: Asia/Dhaka calendar days [from, to], inclusive — the shared
 * parseAdminRange / dhakaRangeUtc convention (src/orders/range-params,
 * src/lib/dhaka-date), same as the KPI pack.
 *
 * Rows are capped at 200 (newest first) for the panel; `count` and
 * `totalPoisha` are computed over the FULL range with aggregate
 * queries, so the totals stay exact even when the row list is capped
 * (the report says so via `rowsTruncated`).
 */
import { prisma } from "@advance-ecommerce/db";
import { dhakaRangeUtc } from "@/lib/dhaka-date";

export const POS_SALES_ROW_CAP = 200;

export interface PosSaleSummary {
  id: string;
  /** The receipt reference customers/staff quote: PosSale.receiptNo. */
  receiptRef: string;
  createdAt: string;
  totalPoisha: number;
  /** Stored POS method verbatim: CASH | BKASH | NAGAD | CARD. */
  paymentMethod: string;
  /** Σ quantities over the sale's itemsJson lines. */
  itemsCount: number;
  /** Shift opener's display name when it resolves to a User row. */
  cashierLabel?: string;
  registerName?: string;
}

export interface PosSalesReport {
  range: { from: string; to: string };
  rows: PosSaleSummary[];
  /** Full number of sales in range (not just the returned rows). */
  count: number;
  /** Σ totalPoisha over the FULL range. */
  totalPoisha: number;
  rowsTruncated: boolean;
}

interface PosSaleLineLike {
  quantity?: unknown;
}

function itemsCountOf(itemsJson: unknown): number {
  if (!Array.isArray(itemsJson)) return 0;
  let count = 0;
  for (const line of itemsJson as PosSaleLineLike[]) {
    const q = line?.quantity;
    count += typeof q === "number" && Number.isFinite(q) && q > 0 ? Math.floor(q) : 1;
  }
  return count;
}

export async function getPosSalesReport(fromYmd: string, toYmd: string): Promise<PosSalesReport> {
  const { startUtc, endUtc } = dhakaRangeUtc(fromYmd, toYmd);
  const where = { createdAt: { gte: startUtc, lte: endUtc } };

  const [count, aggregate, rows] = await Promise.all([
    prisma.posSale.count({ where }),
    prisma.posSale.aggregate({ where, _sum: { totalPoisha: true } }),
    prisma.posSale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: POS_SALES_ROW_CAP,
      include: {
        shift: { include: { register: { select: { name: true } } } },
      },
    }),
  ]);

  // Cashier labels: resolve the shifts' openedById values to User
  // display names in one query. An opener that is not a User row
  // (legacy/free-text id) simply yields no cashierLabel — the row
  // still shows its register.
  const openerIds = [...new Set(rows.map((r) => r.shift.openedById).filter((v): v is string => !!v))];
  const openers =
    openerIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: openerIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const openerLabel = new Map(openers.map((u) => [u.id, u.name ?? u.email ?? undefined]));

  return {
    range: { from: fromYmd, to: toYmd },
    rows: rows.map((row) => ({
      id: row.id,
      receiptRef: row.receiptNo,
      createdAt: row.createdAt.toISOString(),
      totalPoisha: row.totalPoisha,
      paymentMethod: row.paymentMethod,
      itemsCount: itemsCountOf(row.itemsJson),
      ...(row.shift.openedById && openerLabel.get(row.shift.openedById)
        ? { cashierLabel: openerLabel.get(row.shift.openedById) }
        : {}),
      ...(row.shift.register?.name ? { registerName: row.shift.register.name } : {}),
    })),
    count,
    totalPoisha: aggregate._sum.totalPoisha ?? 0,
    rowsTruncated: count > rows.length,
  };
}
