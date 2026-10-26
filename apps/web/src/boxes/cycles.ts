/**
 * Subscription-box cycle keys (ADV-23 vertical 4, doc 23 wave 56) —
 * PURE module: no Prisma, no server imports, safe for client
 * components (the admin contents editor computes upcoming keys in
 * the browser from the same code the generator uses server-side).
 *
 * A box's contents are defined PER CYCLE. The cycle a generation
 * belongs to is derived from the subscription's SCHEDULED run
 * instant (Subscription.nextRunAt at sweep time — the same instant
 * the wave-51 idempotency key is built from, so a replay resolves
 * the same cycle and the same contents):
 *
 *   MONTHLY interval          -> "2026-11"   (Dhaka year-month)
 *   WEEKLY / BIWEEKLY interval -> "2026-W48" (ISO week of the Dhaka day)
 *
 * BIWEEKLY is keyed by the ISO week of its scheduled run: the
 * merchant defines that week's box once and both a weekly and a
 * biweekly subscriber landing in it receive the same box.
 */
import { dhakaYmdOf } from "@/lib/dhaka-date";

export const BOX_CYCLES = ["weekly", "monthly"] as const;
export type BoxCycleKind = (typeof BOX_CYCLES)[number];

/** Subscription.interval values a box cycle kind maps to. Boxes are
 *  offered weekly or monthly (boxes.config.cycles); BIWEEKLY stays a
 *  wave-51 per-product interval and is never offered for a box. */
export const CYCLE_INTERVALS: Record<BoxCycleKind, "WEEKLY" | "MONTHLY"> = {
  weekly: "WEEKLY",
  monthly: "MONTHLY",
};

export const MONTHLY_CYCLE_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const WEEKLY_CYCLE_KEY_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

export function isValidCycleKey(key: string): boolean {
  return MONTHLY_CYCLE_KEY_RE.test(key) || WEEKLY_CYCLE_KEY_RE.test(key);
}

export function cycleKindOfKey(key: string): BoxCycleKind | null {
  if (MONTHLY_CYCLE_KEY_RE.test(key)) return "monthly";
  if (WEEKLY_CYCLE_KEY_RE.test(key)) return "weekly";
  return null;
}

/** The cycle kind a subscription interval generates in. Unknown
 *  legacy intervals fall back to monthly, matching addInterval's
 *  documented default in src/subscriptions/service.ts. */
export function cycleKindOfInterval(interval: string): BoxCycleKind {
  return interval === "WEEKLY" || interval === "BIWEEKLY" ? "weekly" : "monthly";
}

/** ISO-8601 week key ("2026-W48") for a yyyy-mm-dd calendar day. */
export function isoWeekKeyOfYmd(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  // The Thursday of the current week fixes the ISO year.
  const mondayBasedDay = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - mondayBasedDay + 3); // Thursday
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstMondayBasedDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstMondayBasedDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** The cycle key a generation scheduled at `instant` belongs to. */
export function cycleKeyForInterval(interval: string, instant: Date): string {
  const ymd = dhakaYmdOf(instant);
  return cycleKindOfInterval(interval) === "monthly" ? ymd.slice(0, 7) : isoWeekKeyOfYmd(ymd);
}

/** Marker written into the generated order's note (the OrderNote
 *  marker convention — `[pickup:<id>]`, `[rx-record]`): reading it
 *  back from the last generated order is how the account page and
 *  the admin list know EXACTLY which cycle an order carried,
 *  without re-deriving it from timestamps. */
export const BOX_NOTE_MARKER_RE = /\[box:(\d{4}-(?:0[1-9]|1[0-2])|\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3]))\]/;

export function boxCycleKeyFromNoteText(text: string): string | null {
  const match = BOX_NOTE_MARKER_RE.exec(text);
  return match ? (match[1] as string) : null;
}
