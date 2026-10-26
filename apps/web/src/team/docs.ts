/**
 * Team ops (ADV-27 remainder, doc 22) — shared persistence + staff
 * directory for attendance, shifts, targets and the daily digest.
 *
 * PERSISTENCE — Setting JSON docs (house pattern: saved reports,
 * marketing docs, warehouse pick lists). No schema changes in this
 * slice. Keys:
 *   team.attendance.<yyyy-mm>  -> { version: 1, entries: [...] }
 *   team.shifts                -> { version: 1, shifts: [...] }
 *   team.targets.<yyyy-mm>     -> { version: 1, targets: [...] }
 *   team.digest.recipients    -> { version: 1, emails: [...] }
 *
 * READ-MODIFY-WRITE CAVEAT (same as warehouse pick lists v1): each doc
 * is ONE Setting row rewritten whole on every mutation. Two managers
 * editing the same doc in the same second can race (last write wins
 * for the whole doc). Acceptable for a single-store team at v1; a
 * dedicated table is the v2 step if contention ever shows up.
 *
 * Docs are machine-shaped, so they bypass the generic settings API
 * (which rejects unregistered keys by design) and are zod-validated
 * here on every read — a corrupt doc reads as empty, never throws.
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";

export class TeamError extends Error {
  code: string;
  httpStatus: number;
  details?: unknown;
  constructor(code: string, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

/* ------------------------------------------------------------------ */
/* Setting JSON doc store                                              */
/* ------------------------------------------------------------------ */

export async function readSettingDoc(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function writeSettingDoc(key: string, value: string, actorId: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: {
      key,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "team",
      description: "Team ops document (JSON, ADV-27)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
}

export async function deleteSettingDoc(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
}

/** Read + zod-parse a doc; a missing/corrupt doc yields `fallback`. */
export async function readDoc<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const raw = await readSettingDoc(key);
  if (raw === null) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export async function writeDoc(key: string, value: unknown, actorId: string): Promise<void> {
  await writeSettingDoc(key, JSON.stringify(value), actorId);
}

/* ------------------------------------------------------------------ */
/* Staff directory (mirrors app/api/v1/admin/staff/store.ts exactly:   */
/* same derivation, so the team page never disagrees with /admin/staff) */
/* ------------------------------------------------------------------ */

export type TeamStaffStatus = "ACTIVE" | "INVITED" | "SUSPENDED";

export interface TeamStaffMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: TeamStaffStatus;
}

export async function listTeamStaff(): Promise<TeamStaffMember[]> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      lastLoginAt: true,
      inviteTokenHash: true,
      role: { select: { name: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name ?? "",
    email: u.email ?? "",
    phone: u.phone ?? "",
    role: u.role?.name ?? "",
    status: u.isActive
      ? "ACTIVE"
      : u.inviteTokenHash !== null
        ? "INVITED"
        : u.lastLoginAt === null
          ? "INVITED"
          : "SUSPENDED",
  }));
}

/** Validate that every id belongs to a real (non-deleted) staff user. */
export async function assertStaffIds(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const found = await prisma.user.findMany({
    where: { id: { in: userIds }, deletedAt: null },
    select: { id: true },
  });
  const foundIds = new Set(found.map((u) => u.id));
  const unknown = userIds.filter((id) => !foundIds.has(id));
  if (unknown.length > 0) {
    throw new TeamError(
      "UNKNOWN_STAFF",
      `Unknown staff id(s): ${unknown.join(", ")}`,
      400,
      { unknown },
    );
  }
}

/* ------------------------------------------------------------------ */
/* Small shared validators                                             */
/* ------------------------------------------------------------------ */

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be yyyy-mm");

export const ymdSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "date must be yyyy-mm-dd");

export const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM (24h)");

/** Minutes since Dhaka midnight for an instant (Asia/Dhaka, no DST). */
export function dhakaMinutesOf(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h as number) * 60 + (m as number);
}

/** Last day-of-month as yyyy-mm-dd for a yyyy-mm month. */
export function monthLastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y as number, m as number, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  return Number(monthLastDay(month).slice(8, 10));
}
