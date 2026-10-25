/**
 * Asia/Dhaka calendar helpers (doc 17, batch O8-2).
 *
 * Dhaka is UTC+06:00 year-round (no DST), so a Dhaka business day is
 * an exact UTC window: `${ymd}T00:00:00.000+06:00` …
 * `${ymd}T23:59:59.999+06:00`. This mirrors the convention already used
 * by src/reports/db-rows.ts. All report/closing code that reasons
 * about "a day" should go through here instead of re-deriving offsets.
 */

const DHAKA_OFFSET = "+06:00";
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(value: string): boolean {
  if (!YMD_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** yyyy-mm-dd of an instant on the Asia/Dhaka calendar. */
export function dhakaYmdOf(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function todayDhakaYmd(now: Date = new Date()): string {
  return dhakaYmdOf(now);
}

/** Shift a yyyy-mm-dd by whole days (calendar arithmetic in UTC is
 *  exact here because a ymd has no timezone of its own). */
export function shiftYmd(ymd: string, deltaDays: number): string {
  const base = new Date(`${ymd}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

/** Inclusive UTC window for one Dhaka day. */
export function dhakaDayRangeUtc(ymd: string): { startUtc: Date; endUtc: Date } {
  return {
    startUtc: new Date(`${ymd}T00:00:00.000${DHAKA_OFFSET}`),
    endUtc: new Date(`${ymd}T23:59:59.999${DHAKA_OFFSET}`),
  };
}

/** Inclusive UTC window for a Dhaka day range [fromYmd, toYmd]. */
export function dhakaRangeUtc(
  fromYmd: string,
  toYmd: string,
): { startUtc: Date; endUtc: Date } {
  return {
    startUtc: new Date(`${fromYmd}T00:00:00.000${DHAKA_OFFSET}`),
    endUtc: new Date(`${toYmd}T23:59:59.999${DHAKA_OFFSET}`),
  };
}
