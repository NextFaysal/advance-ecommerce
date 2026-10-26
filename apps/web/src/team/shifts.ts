/**
 * Team shifts (ADV-27 remainder, doc 22) — named daily windows staff
 * are rostered into. Stored as ONE Setting doc `team.shifts`.
 *
 * Shifts are INFORMATIONAL: a check-in that falls inside a shift
 * window for that user records the shift's name on the attendance
 * entry. There is deliberately NO payroll math, NO late penalty and
 * NO overtime computation anywhere in this slice — nothing here
 * invents employment rules the business never stated.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  TeamError,
  assertStaffIds,
  dhakaMinutesOf,
  hhmmSchema,
  hhmmToMinutes,
  readDoc,
  writeDoc,
} from "./docs";

export const SHIFTS_KEY = "team.shifts";

export const shiftSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  startHHMM: hhmmSchema,
  endHHMM: hhmmSchema,
  userIds: z.array(z.string().min(1)).max(500),
});

export type Shift = z.infer<typeof shiftSchema>;

const shiftsDocSchema = z.object({
  version: z.literal(1),
  shifts: z.array(shiftSchema),
});

export const shiftInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startHHMM: hhmmSchema,
  endHHMM: hhmmSchema,
  userIds: z.array(z.string().min(1)).max(500).default([]),
});

export type ShiftInput = z.infer<typeof shiftInputSchema>;

export async function listShifts(): Promise<Shift[]> {
  const doc = await readDoc(SHIFTS_KEY, shiftsDocSchema, { version: 1 as const, shifts: [] });
  return doc.shifts;
}

async function saveShifts(shifts: Shift[], actorId: string): Promise<void> {
  await writeDoc(SHIFTS_KEY, { version: 1, shifts }, actorId);
}

export async function createShift(input: ShiftInput, actorId: string): Promise<Shift> {
  await assertStaffIds(input.userIds);
  const shift: Shift = { id: randomUUID(), ...input, userIds: [...new Set(input.userIds)] };
  const shifts = await listShifts();
  shifts.push(shift);
  await saveShifts(shifts, actorId);
  return shift;
}

export async function updateShift(id: string, input: ShiftInput, actorId: string): Promise<Shift> {
  await assertStaffIds(input.userIds);
  const shifts = await listShifts();
  const idx = shifts.findIndex((s) => s.id === id);
  if (idx === -1) throw new TeamError("SHIFT_NOT_FOUND", "Shift not found.", 404);
  const updated: Shift = { id, ...input, userIds: [...new Set(input.userIds)] };
  shifts[idx] = updated;
  await saveShifts(shifts, actorId);
  return updated;
}

export async function deleteShift(id: string, actorId: string): Promise<void> {
  const shifts = await listShifts();
  const next = shifts.filter((s) => s.id !== id);
  if (next.length === shifts.length) throw new TeamError("SHIFT_NOT_FOUND", "Shift not found.", 404);
  await saveShifts(next, actorId);
}

/**
 * The shift (if any) whose window contains `instant` on the Dhaka
 * clock AND whose roster includes `userId`. A window with
 * end <= start wraps past midnight (night shift: 22:00–06:00 matches
 * 23:30 and 02:15, not 12:00). First match in doc order wins.
 */
export function matchShift(shifts: Shift[], userId: string, instant: Date): Shift | null {
  const t = dhakaMinutesOf(instant);
  for (const shift of shifts) {
    if (!shift.userIds.includes(userId)) continue;
    const start = hhmmToMinutes(shift.startHHMM);
    const end = hhmmToMinutes(shift.endHHMM);
    const inside = end > start ? t >= start && t < end : t >= start || t < end;
    if (inside) return shift;
  }
  return null;
}
