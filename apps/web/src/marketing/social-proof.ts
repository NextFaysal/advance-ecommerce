/**
 * Social proof — HONEST variants only (doc 23 wave 60 / doc 21 P11).
 *
 * Every value this module produces comes from REAL Order rows in
 * the database. There is deliberately NO viewer count, NO "X people
 * are looking at this" counter and NO invented purchase number
 * anywhere in this wave: those patterns cannot be backed by real
 * data in this codebase, so they are not built. The flash-sale
 * countdown (src/marketing/flash-sale-countdown.tsx) is unchanged —
 * it already targets the real FlashSale.endsAt of a live sale row.
 *
 * What lives here:
 *  - the `module.social_proof` flag reader (flag registered in the
 *    seed + src/lib/feature-flags.ts catalogue by the parent wave;
 *    until then this reader returns false and every surface below
 *    stays dark — the paid-add-on default),
 *  - listRecentOrderProof(): the recent-orders read model behind
 *    GET /api/v1/public/social-proof/recent and the homepage/PDP
 *    ticker,
 *  - LOW_STOCK_THRESHOLD for the PDP's real low-stock line (the
 *    rendering itself lives in BuyBoxActions, which owns the
 *    selected-variant state; it only ever prints the variant's
 *    actual stock).
 *
 * PRIVACY PROJECTION (the point of this module): a public ticker
 * must never leak who bought what in identifiable form. Each entry
 * carries ONLY:
 *  - the customer's FIRST name (first whitespace token of the
 *    order's customerName snapshot — never the full name),
 *  - the district (never upazila, union, address line or phone),
 *  - the product name of the order's FIRST item,
 *  - the order's creation instant (the client renders the relative
 *    "N ঘণ্টা আগে" from this timestamp, so the words stay truthful
 *    even when the API response is edge-cached).
 * Order totals, order numbers, customer ids and phone numbers are
 * never selected, let alone returned.
 *
 * ELIGIBILITY: an entry must be a genuine purchase, not a cart
 * someone abandoned at the first step. An order qualifies when its
 * status has been accepted into fulfilment (CONFIRMED, PROCESSING,
 * PACKED, SHIPPED, DELIVERED — COD orders live here without any
 * payment), or it is still PENDING but its paymentStatus is PAID
 * (prepaid / advance-paid orders awaiting confirmation). Plain
 * PENDING-unpaid, CANCELLED, FAILED, REFUNDED and returned orders
 * never appear.
 *
 * Fail-safe: any DB error returns [] — a marketing surface must
 * never break the storefront (same convention as the flash-sale
 * section and src/catalog/server-read). [] renders nothing.
 */
import { prisma } from "@advance-ecommerce/db";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const SOCIAL_PROOF_FLAG = "module.social_proof";

export function socialProofEnabled(): boolean {
  return isFeatureEnabled(SOCIAL_PROOF_FLAG);
}

/** The ticker renders NOTHING below this many real entries —
 *  a one- or two-item ticker would expose how thin the data is
 *  and reads as filler; silence is the honest render. */
export const RECENT_ORDERS_MIN_ENTRIES = 3;

/** Cap on entries handed to the ticker (rotation pool). */
export const RECENT_ORDERS_LIMIT = 20;

/** Look-back window for "recent" orders, in days. */
export const RECENT_ORDERS_WINDOW_DAYS = 30;

/**
 * PDP low-stock line: shown for the selected variant only while
 * its REAL stock is 1..LOW_STOCK_THRESHOLD. Stock 0 is plain
 * out-of-stock (never dressed up as urgency) and anything above
 * the threshold shows no scarcity copy at all.
 */
export const LOW_STOCK_THRESHOLD = 5;

export interface RecentOrderProof {
  /** Customer first name only — never the full name. */
  firstName: string;
  /** District only — never finer address detail. */
  district: string;
  /** Product name of the order's first item (OrderItem snapshot). */
  productName: string;
  /** ISO instant the order was created. */
  orderedAt: string;
}

export async function listRecentOrderProof(
  now: Date = new Date(),
): Promise<RecentOrderProof[]> {
  try {
    const since = new Date(
      now.getTime() - RECENT_ORDERS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const rows = await prisma.order.findMany({
      where: {
        deletedAt: null,
        createdAt: { gte: since },
        OR: [
          {
            status: {
              in: ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"],
            },
          },
          { status: "PENDING", paymentStatus: "PAID" },
        ],
      },
      orderBy: { createdAt: "desc" },
      // Headroom: rows dropped by the projection (no items, blank
      // name/district) must not shrink the pool below the cap.
      take: RECENT_ORDERS_LIMIT * 2,
      select: {
        customerName: true,
        district: true,
        createdAt: true,
        items: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { productName: true },
        },
      },
    });

    const entries: RecentOrderProof[] = [];
    for (const row of rows) {
      const firstName = row.customerName.trim().split(/\s+/)[0] ?? "";
      const district = row.district.trim();
      const productName = row.items[0]?.productName.trim() ?? "";
      if (firstName === "" || district === "" || productName === "") continue;
      entries.push({
        firstName,
        district,
        productName,
        orderedAt: row.createdAt.toISOString(),
      });
      if (entries.length >= RECENT_ORDERS_LIMIT) break;
    }
    return entries;
  } catch {
    return [];
  }
}
