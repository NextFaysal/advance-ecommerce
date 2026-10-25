/**
 * Orders list v2 support (doc 17, batch O6-2) — the SQL-level pieces
 * behind GET /api/v1/admin/orders v2 and GET /api/v1/admin/orders/aging.
 *
 * Why a separate module: the row fetch itself still lives in
 * repository.listOrders (single source for the row shape), but the
 * v2 additions — full-set status counts and the aging buckets — are
 * pure Prisma aggregates that must never degrade into
 * fetch-all-and-slice. They live here, unit-testable without an HTTP
 * request scope, and the routes stay thin.
 *
 * Counts semantics (deliberate): the status chips must stay
 * meaningful while a status filter is active, so counts are computed
 * over the set filtered by EVERYTHING EXCEPT the status param
 * (search + paymentStatus + paymentMethod + courier still apply).
 * meta.total, by contrast, is the full count WITH the status filter
 * applied — the number the pager needs.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@advance-ecommerce/validators";
import type { OrderStatus } from "./types";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED",
  "DELIVERED", "FAILED", "RETURN_REQUESTED", "RETURNING", "RETURNED",
  "CANCELLED", "REFUNDED", "EXCHANGED",
];

/** Sort keys accepted by the v2 list endpoint (single query param). */
export type OrderListSort =
  | "createdAt_desc"
  | "createdAt_asc"
  | "totalPoisha_desc"
  | "totalPoisha_asc"
  | "status_asc"
  | "status_desc";

export const ORDER_LIST_SORTS: readonly OrderListSort[] = [
  "createdAt_desc", "createdAt_asc",
  "totalPoisha_desc", "totalPoisha_asc",
  "status_asc", "status_desc",
];

/**
 * Search OR for the list `q`/`search` param: order number, customer
 * name and district (case-insensitive contains), phone contains, and
 * — when the needle is 4+ digits — a phone ENDS-WITH match so staff
 * can type the familiar local form ("01712345678" or just the last
 * digits) against the stored normalized +8801XXXXXXXXX number.
 * Shared by repository.listOrders (rows) and the counts below so the
 * two can never disagree about what a search matches.
 */
export function orderSearchOr(search: string): Record<string, unknown>[] {
  const needle = search.trim();
  const or: Record<string, unknown>[] = [
    { orderNo: { contains: needle, mode: "insensitive" } },
    { customerName: { contains: needle, mode: "insensitive" } },
    { district: { contains: needle, mode: "insensitive" } },
    { customerPhone: { contains: needle } },
    { trackingId: { contains: needle, mode: "insensitive" } },
  ];
  if (/^\d{4,}$/.test(needle)) {
    or.push({ customerPhone: { endsWith: needle.replace(/^0/, "") } });
  }
  return or;
}

/* Mirror of repository.ts PAYMENT_METHOD_TO_DB (TS-domain lowercase ->
 * Prisma enum). Kept local so this module never imports the
 * repository (the repository imports orderSearchOr from here — the
 * reverse import would cycle). Unmapped values match nothing,
 * exactly like listOrders. */
const PAYMENT_METHOD_TO_DB: Record<string, string> = {
  cod: "COD",
  bkash: "BKASH",
  nagad: "NAGAD",
  sslcommerz: "SSLCOMMERZ",
  aamarpay: "AAMARPAY",
  shurjopay: "SHURJOPAY",
};

export interface OrderListFilterInput {
  paymentStatus?: string;
  /** TS-domain payment method (lowercase); unmapped values match nothing. */
  paymentMethod?: string;
  courier?: string;
  search?: string;
}

export type OrderStatusCounts = Record<OrderStatus, number> & { ALL: number };

function emptyCounts(): OrderStatusCounts {
  const counts = { ALL: 0 } as OrderStatusCounts;
  for (const s of ORDER_STATUSES) counts[s] = 0;
  return counts;
}

/**
 * Full-set status counts via ONE Prisma groupBy — the where carries
 * every list filter EXCEPT status (see the header for why). Statuses
 * with no rows come back as explicit zeros so the chips can render
 * the whole map without null checks.
 */
export async function countOrdersByStatus(
  filters: OrderListFilterInput,
): Promise<OrderStatusCounts> {
  const counts = emptyCounts();
  const where: Record<string, unknown> = { deletedAt: null };
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.paymentMethod) {
    const dbMethod = PAYMENT_METHOD_TO_DB[filters.paymentMethod];
    if (!dbMethod) return counts; // unmapped method matches nothing
    where.paymentMethod = dbMethod;
  }
  if (filters.courier) where.courier = filters.courier;
  if (filters.search) where.OR = orderSearchOr(filters.search);

  const grouped = await prisma.order.groupBy({
    by: ["status"],
    where: where as never,
    _count: { _all: true },
  });
  for (const row of grouped) {
    const n = row._count._all;
    counts[row.status as OrderStatus] = n;
    counts.ALL += n;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Aging / stuck board                                                 */
/* ------------------------------------------------------------------ */

export interface AgingOrderRow {
  id: string;
  orderNo: string;
  status: OrderStatus;
  /** Age in hours against the bucket's reference timestamp. */
  ageHours: number;
  totalPoisha: number;
  customerPhoneMasked: string;
}

export interface AgingBucket {
  key: string;
  labelBn: string;
  labelEn: string;
  count: number;
  orders: AgingOrderRow[];
}

interface BucketDef {
  key: string;
  labelBn: string;
  labelEn: string;
  status: OrderStatus;
  /** Timestamp the bucket ages against (and filters on). */
  field: "createdAt" | "updatedAt";
  thresholdHours: number;
}

/**
 * The stuck-work buckets. Thresholds are deliberately conservative —
 * a bucket should mean "a human should look at this", not "this is
 * merely not instant". Reference field per bucket: a PENDING order
 * ages from creation; the others age from their last update (the
 * moment they entered / last moved within the stuck state, as far as
 * the row can tell).
 */
const AGING_BUCKETS: readonly BucketDef[] = [
  { key: "pending_old", labelBn: "পুরনো অপেক্ষমাণ (২৪ ঘণ্টা+)", labelEn: "Pending over 24h", status: "PENDING", field: "createdAt", thresholdHours: 24 },
  { key: "confirmed_unpacked", labelBn: "নিশ্চিত কিন্তু প্যাক হয়নি (৪৮ ঘণ্টা+)", labelEn: "Confirmed, unpacked over 48h", status: "CONFIRMED", field: "updatedAt", thresholdHours: 48 },
  { key: "shipped_undelivered", labelBn: "পাঠানো হয়েছে, ডেলিভারি হয়নি (৫ দিন+)", labelEn: "Shipped, undelivered over 5d", status: "SHIPPED", field: "updatedAt", thresholdHours: 5 * 24 },
  { key: "returning_stuck", labelBn: "রিটার্ন আটকে আছে (৭ দিন+)", labelEn: "Return in transit over 7d", status: "RETURNING", field: "updatedAt", thresholdHours: 7 * 24 },
];

const AGING_TOP_N = 10;

/**
 * Aging board data: per bucket, the FULL count (SQL count) plus the
 * top-10 oldest orders (reference timestamp ascending). Phones are
 * masked here — the board never carries a full number.
 */
export async function getOrderAging(now: Date = new Date()): Promise<AgingBucket[]> {
  const buckets: AgingBucket[] = [];
  for (const def of AGING_BUCKETS) {
    const cutoff = new Date(now.getTime() - def.thresholdHours * 3_600_000);
    const where = {
      deletedAt: null,
      status: def.status,
      [def.field]: { lt: cutoff },
    } as never;
    const [count, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { [def.field]: "asc" } as never,
        take: AGING_TOP_N,
        select: {
          id: true,
          orderNo: true,
          status: true,
          totalPoisha: true,
          customerPhone: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    buckets.push({
      key: def.key,
      labelBn: def.labelBn,
      labelEn: def.labelEn,
      count,
      orders: rows.map((o) => {
        const ref = def.field === "createdAt" ? o.createdAt : o.updatedAt;
        return {
          id: o.id,
          orderNo: o.orderNo,
          status: o.status as OrderStatus,
          ageHours: Math.round(((now.getTime() - ref.getTime()) / 3_600_000) * 10) / 10,
          totalPoisha: o.totalPoisha,
          customerPhoneMasked: maskPhone(o.customerPhone),
        };
      }),
    });
  }
  return buckets;
}
