import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRiderAdmin, riderGuardError } from "@/riders/guard";
import { codHandoverLine, computeRiderPerformance, toRiderView } from "@/riders/service";
import { riderStore } from "@/riders/db-store";
import type { RiderStatus } from "@/riders/types";

// One rider — Agent 18 (E3). GET: rider (masked) + performance + COD
// handover lines. PATCH: status change (staff action; going ON_DELIVERY
// is system-driven by assignment, so it is not a manual target here).

const RIDER_STATUS_TARGETS: readonly RiderStatus[] = ["ACTIVE", "INACTIVE", "SUSPENDED"];

const patchSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireRiderAdmin("riders.view");
  if (!guard.ok) return NextResponse.json(riderGuardError(guard), { status: guard.status });
  const rider = await riderStore.getRider(params.id);
  if (!rider) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Rider not found." } }, { status: 404 });
  }
  const deliveries = await riderStore.listDeliveries(rider.id);
  return NextResponse.json({
    data: {
      rider: toRiderView(rider),
      performance: computeRiderPerformance(rider, deliveries),
      codHandover: deliveries.filter((d) => d.status === "DELIVERED").map(codHandoverLine),
      deliveries,
    },
    meta: { persistence: "database" },
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireRiderAdmin("riders.manage");
  if (!guard.ok) return NextResponse.json(riderGuardError(guard), { status: guard.status });
  const rider = await riderStore.getRider(params.id);
  if (!rider) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Rider not found." } }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success || !RIDER_STATUS_TARGETS.includes(parsed.data.status)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid rider status.", details: parsed.success ? undefined : parsed.error.issues } },
      { status: 400 },
    );
  }
  const updated = { ...rider, status: parsed.data.status };
  await riderStore.replaceRider(updated);
  return NextResponse.json({
    data: { rider: toRiderView(updated) },
    meta: { persistence: "database" },
  });
}
