/**
 * Prisma-backed rider store — DB-backed since 2026-10-24.
 *
 * Server-only (imports the Prisma client): API routes import this file
 * directly; src/riders/store.ts stays Prisma-free for client safety.
 *
 * OTP DISCIPLINE (unchanged): only the SHA-256 hash of a delivery OTP
 * is ever written (proofOtpHash). Plain codes exist only inside the
 * transition request that hashes them (src/riders/proof.ts) — this
 * store never sees one.
 *
 * SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
 *  - Rider.vehicleReg has NO column: echoes on write, absent on read.
 *  - RiderDelivery has NO zone column: a delivery's zoneId reads back
 *    as its rider's (current) zone — assignment always picks a rider
 *    for the delivery's zone, so they agree at assignment time.
 *  - codCollectedPoisha / codHandedOverPoisha are non-null Ints with
 *    default 0 where the TS contract uses undefined for "not yet":
 *    reads map 0 -> undefined unless the delivery is DELIVERED (where
 *    a collected 0 is a real prepaid outcome) — a recorded handover of
 *    exactly 0 poisha therefore cannot be represented; handovers are
 *    positive in practice and shortage math uses codAmountPoisha.
 *  - FAILED completion time has NO column (deliveredAt is delivery
 *    only): a FAILED delivery reads back completedAt undefined.
 *  - Proof capturedAt has NO column: reads back as deliveredAt.
 *  - Soft delete (deletedAt) is respected on rider reads.
 */
import { prisma } from "@advance-ecommerce/db";
import { DEMO_RIDER_ZONES, RiderPhoneTakenError, type RiderStore } from "./store";
import type { DeliveryProof, Rider, RiderDelivery, RiderZone, VehicleType } from "./types";

type RiderRow = Awaited<ReturnType<typeof prisma.rider.findMany>>[number];
type DeliveryRow = Awaited<ReturnType<typeof prisma.riderDelivery.findMany>>[number];

const VEHICLES: readonly VehicleType[] = ["BICYCLE", "MOTORCYCLE", "VAN"];

function rowToRider(row: RiderRow): Rider {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    vehicle: VEHICLES.includes(row.vehicleType as VehicleType)
      ? (row.vehicleType as VehicleType)
      : "MOTORCYCLE",
    zoneId: row.zone,
    status: row.status,
    payoutPerDeliveryPoisha: row.payoutPerDeliveryPoisha,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToDelivery(row: DeliveryRow, zoneId: string): RiderDelivery {
  let proof: DeliveryProof | undefined;
  if (row.proofType) {
    const capturedAt = (row.deliveredAt ?? row.assignedAt).toISOString();
    if (row.proofType === "OTP") {
      proof = { kind: "OTP", otpHash: row.proofOtpHash ?? undefined, capturedAt };
    } else if (row.proofType === "SIGNATURE") {
      proof = { kind: "SIGNATURE", signatureRef: row.proofRef ?? undefined, capturedAt };
    } else if (row.proofType === "PHOTO") {
      proof = { kind: "PHOTO", photoRef: row.proofRef ?? undefined, capturedAt };
    }
  }
  return {
    id: row.id,
    orderId: row.orderId,
    riderId: row.riderId,
    zoneId,
    status: row.status,
    codAmountPoisha: row.codExpectedPoisha,
    codCollectedPoisha:
      row.codCollectedPoisha > 0 ? row.codCollectedPoisha : row.status === "DELIVERED" ? 0 : undefined,
    codHandedOverPoisha: row.codHandedOverPoisha > 0 ? row.codHandedOverPoisha : undefined,
    assignedAt: row.assignedAt.toISOString(),
    pickedUpAt: row.pickedUpAt?.toISOString(),
    completedAt: row.deliveredAt?.toISOString(),
    failureReason: row.failureReason ?? undefined,
    proof,
  };
}

function deliveryWriteData(d: RiderDelivery) {
  return {
    riderId: d.riderId,
    orderId: d.orderId,
    status: d.status,
    codExpectedPoisha: d.codAmountPoisha,
    codCollectedPoisha: d.codCollectedPoisha ?? 0,
    codHandedOverPoisha: d.codHandedOverPoisha ?? 0,
    proofType: d.proof?.kind ?? null,
    proofOtpHash: d.proof?.kind === "OTP" ? (d.proof.otpHash ?? null) : null,
    proofRef:
      d.proof?.kind === "SIGNATURE"
        ? (d.proof.signatureRef ?? null)
        : d.proof?.kind === "PHOTO"
          ? (d.proof.photoRef ?? null)
          : null,
    failureReason: d.failureReason ?? null,
    pickedUpAt: d.pickedUpAt ? new Date(d.pickedUpAt) : null,
    deliveredAt: d.status === "DELIVERED" ? (d.completedAt ? new Date(d.completedAt) : new Date()) : null,
  };
}

export class PrismaRiderStore implements RiderStore {
  listZones(): RiderZone[] { return [...DEMO_RIDER_ZONES]; }

  async listRiders(): Promise<Rider[]> {
    const rows = await prisma.rider.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToRider);
  }

  async getRider(id: string): Promise<Rider | undefined> {
    const row = await prisma.rider.findFirst({ where: { id, deletedAt: null } });
    return row ? rowToRider(row) : undefined;
  }

  async addRider(r: Rider): Promise<Rider> {
    const taken = await prisma.rider.findUnique({ where: { phone: r.phone }, select: { id: true } });
    if (taken) throw new RiderPhoneTakenError(r.phone);
    try {
      const row = await prisma.rider.create({
        data: {
          ...(r.id ? { id: r.id } : {}),
          name: r.name,
          phone: r.phone,
          vehicleType: r.vehicle,
          zone: r.zoneId,
          status: r.status,
          payoutPerDeliveryPoisha: r.payoutPerDeliveryPoisha,
        },
      });
      // Write echo: vehicleReg is not persisted (see header) but the
      // create response keeps it, matching the previous route contract.
      return { ...rowToRider(row), vehicleReg: r.vehicleReg };
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002") {
        throw new RiderPhoneTakenError(r.phone);
      }
      throw err;
    }
  }

  async replaceRider(r: Rider): Promise<void> {
    await prisma.rider.update({
      where: { id: r.id },
      data: {
        name: r.name,
        phone: r.phone,
        vehicleType: r.vehicle,
        zone: r.zoneId,
        status: r.status,
        payoutPerDeliveryPoisha: r.payoutPerDeliveryPoisha,
      },
    });
  }

  async listDeliveries(riderId?: string): Promise<RiderDelivery[]> {
    const rows = await prisma.riderDelivery.findMany({
      where: riderId ? { riderId } : {},
      orderBy: { assignedAt: "asc" },
      include: { rider: { select: { zone: true } } },
    });
    return rows.map((row) => rowToDelivery(row, row.rider.zone));
  }

  async getDelivery(id: string): Promise<RiderDelivery | undefined> {
    const row = await prisma.riderDelivery.findUnique({
      where: { id },
      include: { rider: { select: { zone: true } } },
    });
    return row ? rowToDelivery(row, row.rider.zone) : undefined;
  }

  async addDelivery(d: RiderDelivery): Promise<RiderDelivery> {
    const row = await prisma.riderDelivery.create({
      data: {
        ...(d.id ? { id: d.id } : {}),
        ...deliveryWriteData(d),
        assignedAt: d.assignedAt ? new Date(d.assignedAt) : undefined,
      },
      include: { rider: { select: { zone: true } } },
    });
    return { ...rowToDelivery(row, row.rider.zone), zoneId: d.zoneId };
  }

  async replaceDelivery(d: RiderDelivery): Promise<void> {
    await prisma.riderDelivery.update({
      where: { id: d.id },
      data: deliveryWriteData(d),
    });
  }
}

/** Shared Prisma instance used by the rider API routes. */
export const riderStore: RiderStore = new PrismaRiderStore();
