/**
 * Staff attendance (ADV-27 remainder, doc 22).
 *
 * One Setting doc per month: `team.attendance.<yyyy-mm>` =
 * { version: 1, entries: [{ userId, date, checkInAt, checkOutAt?,
 * note?, shiftName? }] } — date is the Asia/Dhaka calendar date of the
 * CHECK-IN; a night shift checked in at 23:00 and out at 02:00 keeps
 * the whole session on the check-in date (standard roster practice).
 *
 * Rules (deliberately small, nothing invented):
 * - Check-in while an entry is still OPEN returns that same entry
 *   (flagged alreadyOpen) — a duplicate row is never created.
 * - After a check-out, a NEW check-in the same day starts a second
 *   session; the day's hours are the sum of its closed sessions.
 * - Check-out with no open entry is a 409, not a silent no-op.
 * - The matched shift name is recorded at check-in (see shifts.ts).
 * - Hours come only from recorded in/out pairs; an open entry
 *   contributes 0 minutes until it is closed.
 */
import { z } from "zod";
import { dhakaYmdOf, shiftYmd, todayDhakaYmd } from "@/lib/dhaka-date";
import { TeamError, daysInMonth, readDoc, writeDoc } from "./docs";
import { listShifts, matchShift } from "./shifts";

export const attendanceEntrySchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkInAt: z.string().min(1),
  checkOutAt: z.string().min(1).optional(),
  note: z.string().max(500).optional(),
  shiftName: z.string().max(80).optional(),
});

export type AttendanceEntry = z.infer<typeof attendanceEntrySchema>;

const attendanceDocSchema = z.object({
  version: z.literal(1),
  entries: z.array(attendanceEntrySchema),
});

type AttendanceDoc = z.infer<typeof attendanceDocSchema>;

const EMPTY_DOC: AttendanceDoc = { version: 1, entries: [] };

export function attendanceKey(month: string): string {
  return `team.attendance.${month}`;
}

async function readMonthDoc(month: string): Promise<AttendanceDoc> {
  return readDoc(attendanceKey(month), attendanceDocSchema, EMPTY_DOC);
}

export function entryMinutes(entry: AttendanceEntry): number {
  if (!entry.checkOutAt) return 0;
  const ms = new Date(entry.checkOutAt).getTime() - new Date(entry.checkInAt).getTime();
  return ms > 0 ? Math.round(ms / 60000) : 0;
}

export function isOpen(entry: AttendanceEntry): boolean {
  return entry.checkOutAt === undefined;
}

/** The user's open entry, searching today's doc and — for overnight
 *  sessions — yesterday's doc (which may be last month's). */
async function findOpenEntry(
  userId: string,
  now: Date,
): Promise<{ month: string; doc: AttendanceDoc; index: number } | null> {
  const today = dhakaYmdOf(now);
  const yesterday = shiftYmd(today, -1);
  const months = [...new Set([today.slice(0, 7), yesterday.slice(0, 7)])];
  for (const month of months) {
    const doc = await readMonthDoc(month);
    const index = doc.entries.findIndex((e) => e.userId === userId && isOpen(e));
    if (index >= 0) return { month, doc, index };
  }
  return null;
}

export interface CheckInResult {
  entry: AttendanceEntry;
  /** True when an already-open entry was returned instead of created. */
  alreadyOpen: boolean;
}

export async function checkIn(userId: string, now: Date = new Date()): Promise<CheckInResult> {
  const open = await findOpenEntry(userId, now);
  if (open) {
    return { entry: open.doc.entries[open.index] as AttendanceEntry, alreadyOpen: true };
  }
  const date = dhakaYmdOf(now);
  const month = date.slice(0, 7);
  const shifts = await listShifts();
  const shift = matchShift(shifts, userId, now);
  const entry: AttendanceEntry = {
    userId,
    date,
    checkInAt: now.toISOString(),
    ...(shift ? { shiftName: shift.name } : {}),
  };
  const doc = await readMonthDoc(month);
  doc.entries.push(entry);
  await writeDoc(attendanceKey(month), doc, userId);
  return { entry, alreadyOpen: false };
}

export async function checkOut(userId: string, now: Date = new Date()): Promise<AttendanceEntry> {
  const open = await findOpenEntry(userId, now);
  if (!open) {
    throw new TeamError(
      "NO_OPEN_ENTRY",
      "কোনো খোলা চেক-ইন নেই — আগে চেক-ইন করুন। / No open check-in to close.",
      409,
    );
  }
  const entry = open.doc.entries[open.index] as AttendanceEntry;
  entry.checkOutAt = now.toISOString();
  await writeDoc(attendanceKey(open.month), open.doc, userId);
  return entry;
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

export interface DaySummary {
  date: string;
  sessions: number;
  minutes: number;
  open: boolean;
  shiftNames: string[];
}

export interface UserMonthSummary {
  userId: string;
  presentDays: number;
  totalMinutes: number;
  openSessions: number;
  days: Record<string, DaySummary>;
}

export function summarizeMonth(entries: AttendanceEntry[], month: string): UserMonthSummary[] {
  const byUser = new Map<string, UserMonthSummary>();
  for (const entry of entries) {
    if (!entry.date.startsWith(month)) continue;
    let summary = byUser.get(entry.userId);
    if (!summary) {
      summary = { userId: entry.userId, presentDays: 0, totalMinutes: 0, openSessions: 0, days: {} };
      byUser.set(entry.userId, summary);
    }
    const day = (summary.days[entry.date] ??= {
      date: entry.date,
      sessions: 0,
      minutes: 0,
      open: false,
      shiftNames: [],
    });
    day.sessions += 1;
    day.minutes += entryMinutes(entry);
    if (isOpen(entry)) {
      day.open = true;
      summary.openSessions += 1;
    }
    if (entry.shiftName && !day.shiftNames.includes(entry.shiftName)) {
      day.shiftNames.push(entry.shiftName);
    }
    summary.totalMinutes += entryMinutes(entry);
  }
  for (const summary of byUser.values()) {
    summary.presentDays = Object.keys(summary.days).length;
  }
  return [...byUser.values()];
}

export async function getMonthEntries(month: string): Promise<AttendanceEntry[]> {
  const doc = await readMonthDoc(month);
  return doc.entries;
}

export interface MyAttendance {
  today: string;
  state: "not_checked_in" | "checked_in" | "done";
  todayEntries: AttendanceEntry[];
  todayMinutes: number;
  openEntry: AttendanceEntry | null;
  month: string;
  monthSummary: UserMonthSummary | null;
}

export async function getMyAttendance(userId: string, now: Date = new Date()): Promise<MyAttendance> {
  const today = todayDhakaYmd(now);
  const month = today.slice(0, 7);
  const entries = await getMonthEntries(month);
  const mine = entries.filter((e) => e.userId === userId);
  const todayEntries = mine.filter((e) => e.date === today);
  // An overnight open entry from yesterday still means "checked in".
  const open = await findOpenEntry(userId, now);
  const openEntry = open ? (open.doc.entries[open.index] as AttendanceEntry) : null;
  const todayMinutes = todayEntries.reduce((s, e) => s + entryMinutes(e), 0);
  const state: MyAttendance["state"] =
    openEntry !== null ? "checked_in" : todayEntries.length > 0 ? "done" : "not_checked_in";
  const summary = summarizeMonth(mine, month).find((s) => s.userId === userId) ?? null;
  return { today, state, todayEntries, todayMinutes, openEntry, month, monthSummary: summary };
}

export { daysInMonth };
