/**
 * Shared ?from&to parsing for the admin order report endpoints
 * (doc 17, batch O8-2: kpis + delivery-costs).
 *
 * Params are Asia/Dhaka calendar days (yyyy-mm-dd), inclusive on both
 * ends. Defaults: to = today (Dhaka), from = 29 days earlier (a
 * 30-day window). A reversed range is swapped rather than rejected —
 * the caller plainly meant the window between the two days; a range
 * longer than 366 days is rejected so a typo can't scan forever.
 */
import { isValidYmd, shiftYmd, todayDhakaYmd } from "@/lib/dhaka-date";

export type RangeParse =
  | { ok: true; from: string; to: string }
  | { ok: false; message: string };

export function parseAdminRange(searchParams: URLSearchParams): RangeParse {
  const toRaw = searchParams.get("to");
  const fromRaw = searchParams.get("from");
  const to = toRaw ?? todayDhakaYmd();
  const from = fromRaw ?? shiftYmd(to, -29);
  if (!isValidYmd(to) || !isValidYmd(from)) {
    return {
      ok: false,
      message: "from/to must be yyyy-mm-dd calendar days. / from/to yyyy-mm-dd আকারে দিন।",
    };
  }
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  if (shiftYmd(lo, 366) < hi) {
    return {
      ok: false,
      message: "Range is longer than 366 days. / সর্বোচ্চ ৩৬৬ দিনের পরিসর দেওয়া যাবে।",
    };
  }
  return { ok: true, from: lo, to: hi };
}
