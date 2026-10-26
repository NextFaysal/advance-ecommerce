/**
 * Birthday offers — ADV-18 leftover, built in schema wave 2 once
 * Customer.birthDate existed.
 *
 * runBirthdayOffers(now) is the whole feature: a worker-tick-ready
 * export (the future VPS worker calls it daily; until then the admin
 * run-now endpoint POST /api/v1/admin/marketing/birthday/run is the
 * trigger). It finds every customer whose birthday (MM-DD, read off
 * the stored UTC-midnight birthDate) falls within the next
 * `loyalty.birthday.window_days` days on the Asia/Dhaka calendar and
 * issues them a birthday coupon through the existing Coupon system.
 *
 * DEDUPE IS THE CODE: the coupon code is deterministic —
 * BDAY-<customerId>-<occurrenceYear> — and Coupon.code is @unique, so
 * a re-run (or two racing runs) can never double-issue for the same
 * customer + birthday year. The id is uppercased into the code
 * because checkout's coupon lookup uppercases its input before
 * matching (findCouponByCodeDb) — a mixed-case stored code would be
 * unredeemable.
 *
 * Coupon shape: PERCENT at loyalty.birthday.discount_bps (default
 * 1000 bps = 10%), usageLimit 1 + perUserLimit 1 (one use, by this
 * customer only — per-user enforcement is the checkout coupon path's
 * own rule), valid from issue until 30 days after the birthday.
 *
 * Gated by module.marketing_mechanics like the rest of ADV-18: with
 * the flag OFF the run reports flag_off and issues nothing. Eligible
 * customers are never blocked / soft-deleted rows with a birthDate.
 * Feb-29 birthdays celebrate on Mar 1 in non-leap years (Date.UTC
 * rollover) — noted here so nobody "fixes" it into a skip.
 */
import { prisma } from "@advance-ecommerce/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getSetting } from "@/lib/settings";

export const BIRTHDAY_FLAG = "module.marketing_mechanics";
export const BIRTHDAY_WINDOW_SETTING = "loyalty.birthday.window_days";
export const BIRTHDAY_DISCOUNT_SETTING = "loyalty.birthday.discount_bps";

const DEFAULT_WINDOW_DAYS = 3;
const DEFAULT_DISCOUNT_BPS = 1000;
/** Days after the birthday the coupon stays redeemable. */
const COUPON_VALID_AFTER_DAYS = 30;

export interface BirthdayIssuedCoupon {
  customerId: string;
  code: string;
  /** The birthday occurrence year the code is keyed to. */
  year: number;
}

export type BirthdayRunResult =
  | { status: "skipped"; reason: "flag_off" }
  | {
      status: "ok";
      windowDays: number;
      discountBps: number;
      /** Customers whose birthday falls inside the window. */
      candidates: number;
      issued: BirthdayIssuedCoupon[];
      /** Candidates whose deterministic coupon already existed. */
      alreadyIssued: number;
    };

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** YYYY-MM-DD parts of `now` on the Asia/Dhaka calendar. */
function dhakaDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: part("year"), month: part("month"), day: part("day") };
}

/** The deterministic per-customer-per-year coupon code. */
export function birthdayCouponCode(customerId: string, year: number): string {
  return `BDAY-${customerId.toUpperCase()}-${year}`;
}

export async function runBirthdayOffers(
  now: Date = new Date(),
): Promise<BirthdayRunResult> {
  if (!isFeatureEnabled(BIRTHDAY_FLAG)) return { status: "skipped", reason: "flag_off" };

  const [windowRaw, bpsRaw] = await Promise.all([
    getSetting(BIRTHDAY_WINDOW_SETTING),
    getSetting(BIRTHDAY_DISCOUNT_SETTING),
  ]);
  const windowDays = clampInt(windowRaw, DEFAULT_WINDOW_DAYS, 0, 30);
  const discountBps = clampInt(bpsRaw, DEFAULT_DISCOUNT_BPS, 100, 10_000);
  // Coupon.valuePercent is a whole percent (1–100); bps that do not
  // divide evenly round to the nearest percent (documented in the
  // settings registration) — the default 1000 bps is exactly 10%.
  const valuePercent = Math.min(100, Math.max(1, Math.round(discountBps / 100)));

  const today = dhakaDateParts(now);
  const windowStartUtc = Date.UTC(today.year, today.month - 1, today.day);
  const windowEndUtc = windowStartUtc + windowDays * 24 * 3600 * 1000;

  const customers = await prisma.customer.findMany({
    where: { birthDate: { not: null }, blocked: false, deletedAt: null },
    select: { id: true, birthDate: true },
  });

  const issued: BirthdayIssuedCoupon[] = [];
  let candidates = 0;
  let alreadyIssued = 0;

  for (const customer of customers) {
    const birth = customer.birthDate;
    if (birth === null) continue;
    const birthMonth = birth.getUTCMonth() + 1;
    const birthDay = birth.getUTCDate();
    // The occurrence inside the window: this Dhaka year, or next
    // when the window crosses the year boundary.
    let occurrenceYear: number | null = null;
    for (const year of [today.year, today.year + 1]) {
      const occurrenceUtc = Date.UTC(year, birthMonth - 1, birthDay);
      if (occurrenceUtc >= windowStartUtc && occurrenceUtc <= windowEndUtc) {
        occurrenceYear = year;
        break;
      }
    }
    if (occurrenceYear === null) continue;
    candidates += 1;

    const code = birthdayCouponCode(customer.id, occurrenceYear);
    const existing = await prisma.coupon.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing !== null) {
      alreadyIssued += 1;
      continue;
    }
    const occurrenceUtc = Date.UTC(occurrenceYear, birthMonth - 1, birthDay);
    try {
      await prisma.coupon.create({
        data: {
          code,
          type: "PERCENT",
          valuePercent,
          valuePoisha: null,
          minCartPoisha: null,
          maxDiscountPoisha: null,
          usageLimit: 1,
          perUserLimit: 1,
          productIds: [],
          categoryIds: [],
          customerGroup: null,
          stackable: false,
          isActive: true,
          startsAt: now,
          endsAt: new Date(occurrenceUtc + COUPON_VALID_AFTER_DAYS * 24 * 3600 * 1000),
        },
      });
      issued.push({ customerId: customer.id, code, year: occurrenceYear });
    } catch (error) {
      // The unique code is the dedupe: a concurrent run won the
      // race between our findUnique and create. Count it as already
      // issued; any other failure is real and must surface.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
      ) {
        alreadyIssued += 1;
        continue;
      }
      throw error;
    }
  }

  return {
    status: "ok",
    windowDays,
    discountBps,
    candidates,
    issued,
    alreadyIssued,
  };
}
