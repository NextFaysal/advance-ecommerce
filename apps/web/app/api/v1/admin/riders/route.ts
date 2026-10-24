import { NextResponse } from "next/server";
import { normalizeBdPhone } from "@/checkout/validation";
import { demoRiderFlags } from "@/riders/flags";
import { requireRiderAdmin, riderGuardError } from "@/riders/guard";
import { activeLoad } from "@/riders/assignment";
import { computeRiderPerformance, toRiderView } from "@/riders/service";
import { riderStore } from "@/riders/db-store";
import { RiderPhoneTakenError } from "@/riders/store";
import { createRiderSchema, type Rider } from "@/riders/types";

// Riders — Agent 18, Step 45 (E3). Paid add-on: module.rider is checked
// first by the guard (403 FEATURE_LOCKED when off). Phones are masked in
// every response. DB-backed (Prisma) since 2026-10-24.

export async function GET() {
  const guard = await requireRiderAdmin("riders.view");
  if (!guard.ok) return NextResponse.json(riderGuardError(guard), { status: guard.status });
  const deliveries = await riderStore.listDeliveries();
  const riders = (await riderStore.listRiders()).map((r) => ({
    ...toRiderView(r),
    activeLoad: activeLoad(deliveries, r.id),
    performance: computeRiderPerformance(r, deliveries),
  }));
  return NextResponse.json({
    data: { flags: demoRiderFlags.list(), zones: riderStore.listZones(), riders },
    meta: { persistence: "database" },
  });
}

export async function POST(req: Request) {
  const guard = await requireRiderAdmin("riders.manage");
  if (!guard.ok) return NextResponse.json(riderGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createRiderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid rider.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const phone = normalizeBdPhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Phone must be a valid BD number (01[3-9]XXXXXXXX)." } },
      { status: 400 },
    );
  }
  if (!riderStore.listZones().some((z) => z.id === parsed.data.zoneId)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: `Unknown zone: ${parsed.data.zoneId}` } },
      { status: 400 },
    );
  }
  const rider: Rider = {
    id: `rider_${Date.now()}`,
    name: parsed.data.name,
    phone,
    vehicle: parsed.data.vehicle,
    vehicleReg: parsed.data.vehicleReg,
    zoneId: parsed.data.zoneId,
    status: "ACTIVE",
    payoutPerDeliveryPoisha: parsed.data.payoutPerDeliveryPoisha,
    createdAt: new Date().toISOString(),
  };
  try {
    const saved = await riderStore.addRider(rider);
    return NextResponse.json(
      { data: { rider: toRiderView(saved) }, meta: { persistence: "database" } },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof RiderPhoneTakenError) {
      return NextResponse.json(
        { error: { code: "PHONE_TAKEN", message: "A rider with this phone already exists." } },
        { status: 409 },
      );
    }
    throw err;
  }
}
