/**
 * POS DB store — Prisma-backed persistence (Agent-14 module swap).
 *
 * Replaces the in-memory demo store in service.ts for the POS routes
 * and the admin page. The pure register logic is UNCHANGED
 * (register.ts): sale totals, change rules, expected cash and the
 * variance discipline (counted cash stored exactly; a non-zero variance
 * without a note is rejected; variance is NEVER adjusted) all run
 * exactly as before — this store loads rows, runs the pure functions,
 * and persists the results.
 *
 * POS sales still do NOT create Orders: `syncedOrderId` stays null and
 * route meta keeps `createsOrder: false`. `syncedOrderId` is about
 * ORDER CONVERSION, not sync: an Order requires a customer phone and
 * a full BD address, which a walk-in counter sale does not have —
 * fabricating them would corrupt customer data, so conversion stays
 * future work by design. The OFFLINE SYNC itself is implemented: the
 * browser queues sales in localStorage (src/pos/offline-queue.ts) and
 * flushes them to the POS sale API (src/pos/sync.ts), which dedupes
 * on the sale's idempotencyKey — see rowToSale for how status reads.
 *
 * Deliberate TS <-> schema mappings (drift per docs/AGENT14-REVIEW.md):
 * - PosRegister.status ("ACTIVE") <-> TS isActive. Schema `location`
 *   has no TS counterpart and is not surfaced as warehouseId (it is a
 *   free-text outlet location, not a warehouse id).
 * - PosShift.openedById <-> TS openedBy. TS `closedBy` has NO schema
 *   column and is not persisted; the close note lands in the schema's
 *   `varianceNote`.
 * - PosSale carries `receiptNo` + `itemsJson` in the schema instead of
 *   TS lines/registerId/status/offline: lines live in itemsJson,
 *   registerId is derived from the parent shift. status/offline are
 *   the CLIENT sync state: a row that exists in this store has by
 *   definition been delivered to the server (the sale API is the only
 *   write path), so it reads SYNCED / offline false. QUEUED_OFFLINE
 *   exists only in the browser's localStorage queue before the flush
 *   (src/pos/offline-queue.ts). An earlier version derived status from
 *   syncedOrderId, which nothing ever sets — every recorded sale read
 *   QUEUED_OFFLINE forever, i.e. the UI claimed a delivered sale was
 *   still pending. VOIDED has no schema representation (nothing sets
 *   it in this slice either).
 * - First-run provisioning: when NO register exists at all, the demo
 *   era's default register ("Main Outlet — Counter 1") is created so
 *   the POS works out of the box, mirroring the old demo store's
 *   initial state. It is a real row and can be renamed/deactivated in
 *   the DB.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { closeShift, createSale, openShiftForRegister } from "./register";
import type {
  CreatePosSaleInput,
  PosPaymentMethod,
  PosRegister,
  PosSale,
  PosSaleLine,
  PosShift,
  ShiftStatus,
} from "./types";

type RegisterRow = NonNullable<Awaited<ReturnType<typeof prisma.posRegister.findUnique>>>;
type ShiftRow = NonNullable<Awaited<ReturnType<typeof prisma.posShift.findUnique>>>;
type SaleRow = NonNullable<Awaited<ReturnType<typeof prisma.posSale.findUnique>>>;

export const DEFAULT_REGISTER_NAME = "Main Outlet — Counter 1";

/* ------------------------------------------------------------------ */
/* Row -> TS mappings                                                  */
/* ------------------------------------------------------------------ */

function rowToRegister(row: RegisterRow): PosRegister {
  return { id: row.id, name: row.name, isActive: row.status === "ACTIVE" };
}

function rowToShift(row: ShiftRow): PosShift {
  return {
    id: row.id,
    registerId: row.registerId,
    openedBy: row.openedById ?? "",
    openedAt: row.openedAt.toISOString(),
    openingFloatPoisha: row.openingFloatPoisha,
    status: row.status as ShiftStatus,
    closedAt: row.closedAt?.toISOString(),
    countedCashPoisha: row.countedCashPoisha ?? undefined,
    expectedCashPoisha: row.expectedCashPoisha ?? undefined,
    variancePoisha: row.variancePoisha ?? undefined,
  };
}

function rowToSale(row: SaleRow, registerId: string): PosSale {
  const lines = (Array.isArray(row.itemsJson) ? row.itemsJson : []) as unknown as PosSaleLine[];
  return {
    id: row.id,
    shiftId: row.shiftId,
    registerId,
    idempotencyKey: row.idempotencyKey,
    lines,
    discountPoisha: row.discountPoisha,
    totalPoisha: row.totalPoisha,
    paymentMethod: row.paymentMethod as PosPaymentMethod,
    tenderedPoisha: row.tenderedPoisha ?? undefined,
    // Persisted == delivered to the server == SYNCED (see header).
    // QUEUED_OFFLINE is a client-queue-only state and is never read
    // back from the DB; syncedOrderId (order conversion) is separate.
    status: "SYNCED",
    createdAt: row.createdAt.toISOString(),
    offline: false,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Registers, creating the default register on first run (empty table). */
export async function listRegistersDb(): Promise<PosRegister[]> {
  let rows = await prisma.posRegister.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length === 0) {
    const created = await prisma.posRegister.create({
      data: { name: DEFAULT_REGISTER_NAME, status: "ACTIVE" },
    });
    rows = [created];
  }
  return rows.map(rowToRegister);
}

export async function listShiftsDb(): Promise<PosShift[]> {
  const rows = await prisma.posShift.findMany({ orderBy: { openedAt: "asc" } });
  return rows.map(rowToShift);
}

export async function listSalesDb(): Promise<PosSale[]> {
  const rows = await prisma.posSale.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return [];
  const shifts = await prisma.posShift.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.shiftId))] } },
    select: { id: true, registerId: true },
  });
  const registerByShift = new Map(shifts.map((s) => [s.id, s.registerId]));
  return rows.map((row) => rowToSale(row, registerByShift.get(row.shiftId) ?? ""));
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export type OpenShiftResult =
  | { ok: true; shift: PosShift }
  | { ok: false; status: number; code: string; message: string };

export async function openShiftDb(input: {
  registerId: string;
  openingFloatPoisha: number;
  openedBy: string;
}): Promise<OpenShiftResult> {
  const registers = await listRegistersDb();
  const register = registers.find((r) => r.id === input.registerId);
  if (!register || !register.isActive) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: `Unknown or inactive register: ${input.registerId}`,
    };
  }
  const shifts = await listShiftsDb();
  const existing = openShiftForRegister(shifts, register.id);
  if (existing) {
    return {
      ok: false,
      status: 409,
      code: "SHIFT_ALREADY_OPEN",
      message: `Register ${register.id} already has an open shift (${existing.id}). Close it first.`,
    };
  }
  const row = await prisma.posShift.create({
    data: {
      registerId: register.id,
      openedById: input.openedBy,
      openingFloatPoisha: input.openingFloatPoisha,
      status: "OPEN",
    },
  });
  return { ok: true, shift: rowToShift(row) };
}

export type CloseShiftResult =
  | { ok: true; shift: PosShift; expectedCashPoisha: number; variancePoisha: number }
  | { ok: false; status: number; code: string; message: string };

export async function closeShiftDb(
  shiftId: string,
  input: { countedCashPoisha: number; closedBy: string; note?: string },
): Promise<CloseShiftResult> {
  const row = await prisma.posShift.findUnique({ where: { id: shiftId } });
  if (!row) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: `Unknown shift: ${shiftId}` };
  }
  const shift = rowToShift(row);
  const sales = (await listSalesDb()).filter((s) => s.shiftId === shiftId);
  const result = closeShift(shift, sales, {
    countedCashPoisha: input.countedCashPoisha,
    closedBy: input.closedBy,
    closedAt: new Date().toISOString(),
    note: input.note,
  });
  if (!result.ok) {
    return { ok: false, status: 422, code: "SHIFT_CLOSE_REJECTED", message: result.error };
  }
  const closed = result.shift;
  const updated = await prisma.posShift.update({
    where: { id: shiftId },
    data: {
      status: "CLOSED",
      countedCashPoisha: closed.countedCashPoisha ?? null,
      expectedCashPoisha: closed.expectedCashPoisha ?? null,
      variancePoisha: closed.variancePoisha ?? null,
      varianceNote: input.note ?? null,
      closedAt: closed.closedAt ? new Date(closed.closedAt) : new Date(),
    },
  });
  return {
    ok: true,
    shift: rowToShift(updated),
    expectedCashPoisha: closed.expectedCashPoisha ?? 0,
    variancePoisha: closed.variancePoisha ?? 0,
  };
}

export type CreateSaleResult =
  | { ok: true; sale: PosSale; duplicate: boolean }
  | { ok: false; status: number; code: string; message: string };

/** Receipt number derived from the (unique) idempotency key — stable across replays. */
function receiptNoFor(idempotencyKey: string): string {
  return `POS-${idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase()}`;
}

/**
 * Record a sale. A replayed idempotencyKey returns the FIRST sale with
 * duplicate: true — never a second row (the schema's @unique on
 * idempotencyKey is the backstop). Shift must exist, be OPEN, and
 * belong to the input register — same rules as the old route.
 */
export async function createSaleDb(input: CreatePosSaleInput): Promise<CreateSaleResult> {
  const existingRow = await prisma.posSale.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existingRow) {
    const shiftRow = await prisma.posShift.findUnique({ where: { id: existingRow.shiftId } });
    return { ok: true, sale: rowToSale(existingRow, shiftRow?.registerId ?? ""), duplicate: true };
  }
  const shiftRow = await prisma.posShift.findUnique({ where: { id: input.shiftId } });
  if (!shiftRow) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: `Unknown shift: ${input.shiftId}` };
  }
  if (shiftRow.status !== "OPEN") {
    return {
      ok: false,
      status: 409,
      code: "SHIFT_NOT_OPEN",
      message: `Shift ${shiftRow.id} is ${shiftRow.status}; sales need an open shift.`,
    };
  }
  if (shiftRow.registerId !== input.registerId) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: `Shift ${shiftRow.id} belongs to register ${shiftRow.registerId}, not ${input.registerId}.`,
    };
  }
  const result = createSale(input, { id: randomUUID(), createdAt: new Date().toISOString() });
  if (!result.ok) {
    return { ok: false, status: 422, code: "SALE_REJECTED", message: result.error };
  }
  const sale = result.sale;
  const row = await prisma.posSale.create({
    data: {
      shiftId: input.shiftId,
      receiptNo: receiptNoFor(input.idempotencyKey),
      itemsJson: sale.lines as unknown as object,
      totalPoisha: sale.totalPoisha,
      discountPoisha: sale.discountPoisha,
      paymentMethod: sale.paymentMethod,
      tenderedPoisha: sale.tenderedPoisha ?? null,
      idempotencyKey: input.idempotencyKey,
      syncedOrderId: null,
    },
  });
  return { ok: true, sale: rowToSale(row, shiftRow.registerId), duplicate: false };
}
