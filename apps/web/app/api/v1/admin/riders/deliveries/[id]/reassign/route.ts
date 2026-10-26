/**
 * Rider Delivery Reassign API — /api/v1/admin/riders/deliveries/[id]/reassign
 *
 * Allows supervisors to reassign an in-flight delivery to another active rider.
 * RBAC: riders.manage
 */
import { NextResponse } from "next/server";
import { requireRiderAdmin, riderGuardError } from "@/riders/guard";
import { riderStore } from "@/riders/db-store";
import { writeAudit } from "@/lib/audit";

interface RouteParams {
  params: { id: string };
}

export async function POST(req: Request, { params }: RouteParams) {
  const guard = await requireRiderAdmin("riders.manage");
  if (!guard.ok) return NextResponse.json(riderGuardError(guard), { status: guard.status });

  const { id } = params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Invalid JSON body" } }, { status: 400 });
  }

  const { newRiderId, reason } = (body || {}) as { newRiderId?: string; reason?: string };

  if (!newRiderId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "newRiderId is required." } },
      { status: 400 },
    );
  }

  try {
    const delivery = await riderStore.getDelivery(id);
    if (!delivery) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Delivery not found." } }, { status: 404 });
    }

    if (delivery.status === "DELIVERED" || delivery.status === "FAILED") {
      return NextResponse.json(
        { error: { code: "INVALID_STATE", message: `Cannot reassign completed delivery (${delivery.status}).` } },
        { status: 422 },
      );
    }

    const riders = await riderStore.listRiders();
    const targetRider = riders.find((r) => r.id === newRiderId);
    if (!targetRider) {
      return NextResponse.json(
        { error: { code: "RIDER_NOT_FOUND", message: "Target rider does not exist." } },
        { status: 404 },
      );
    }

    const oldRiderId = delivery.riderId;
    const updatedDelivery = {
      ...delivery,
      riderId: newRiderId,
      assignedAt: new Date().toISOString(),
    };

    await riderStore.replaceDelivery(updatedDelivery);

    await writeAudit({
      actorId: guard.userId,
      action: "riders.delivery.reassign",
      entityType: "RiderDelivery",
      entityId: id,
      beforeJson: { riderId: oldRiderId, status: delivery.status },
      afterJson: { riderId: newRiderId, status: updatedDelivery.status },
      reason: reason || `Reassigned from rider ${oldRiderId} to ${newRiderId}`,
    });

    return NextResponse.json({ data: updatedDelivery });
  } catch (e) {
    console.error("[Rider Reassign Error]", e);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to reassign delivery." } },
      { status: 500 },
    );
  }
}
