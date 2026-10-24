import { NextResponse } from "next/server";
import { requireRiderAdmin, riderGuardError } from "@/riders/guard";
import { chooseRider } from "@/riders/assignment";
import { toRiderView } from "@/riders/service";
import { riderStore } from "@/riders/db-store";
import { assignDeliverySchema, type RiderDelivery } from "@/riders/types";

// Auto-assignment — Agent 18 (E3). Picks the best rider with the pure
// scoring in src/riders/assignment.ts (nearest stub-zone distance, then
// lowest current load). INACTIVE / SUSPENDED riders and unreachable zones
// are excluded there. 422 when nobody is eligible — staff then assign
// manually outside this endpoint. DB-backed (Prisma) since 2026-10-24.

export async function POST(req: Request) {
  const guard = await requireRiderAdmin("riders.manage");
  if (!guard.ok) return NextResponse.json(riderGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = assignDeliverySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid assignment.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const riders = await riderStore.listRiders();
  const deliveries = await riderStore.listDeliveries();
  const candidate = chooseRider(riders, deliveries, parsed.data.zoneId);
  if (!candidate) {
    return NextResponse.json(
      { error: { code: "NO_RIDER_AVAILABLE", message: "No eligible rider for this zone. Assign manually or activate a rider in the zone." } },
      { status: 422 },
    );
  }
  const rider = riders.find((r) => r.id === candidate.riderId);
  if (!rider) {
    return NextResponse.json(
      { error: { code: "NO_RIDER_AVAILABLE", message: "Chosen rider no longer exists." } },
      { status: 422 },
    );
  }
  const now = new Date().toISOString();
  const delivery: RiderDelivery = {
    id: `rdlv_${Date.now()}`,
    orderId: parsed.data.orderId,
    riderId: rider.id,
    zoneId: parsed.data.zoneId,
    status: "ASSIGNED",
    codAmountPoisha: parsed.data.codAmountPoisha,
    assignedAt: now,
  };
  const savedDelivery = await riderStore.addDelivery(delivery);
  if (rider.status === "ACTIVE") await riderStore.replaceRider({ ...rider, status: "ON_DELIVERY" });
  return NextResponse.json({
    data: {
      delivery: savedDelivery,
      rider: toRiderView(rider),
      match: { distanceKm: candidate.distanceKm, activeLoad: candidate.activeLoad, score: candidate.score },
    },
    meta: { persistence: "database" },
  }, { status: 201 });
}
