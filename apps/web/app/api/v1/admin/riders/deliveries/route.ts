import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRiderAdmin, riderGuardError } from "@/riders/guard";
import { applyDeliveryTransition } from "@/riders/assignment";
import { hashDeliveryOtp } from "@/riders/proof";
import { codHandoverLine, recordCodHandover } from "@/riders/service";
import { riderStore } from "@/riders/db-store";
import { deliveryTransitionSchema, type DeliveryProof } from "@/riders/types";

// Rider deliveries — Agent 18 (E3).
// GET: all deliveries with their COD handover lines (accountant view).
// PATCH: state flow ASSIGNED -> PICKED_UP -> DELIVERED / FAILED via the
// pure state machine. DELIVERED requires a proof: an OTP (plain code in
// this request is hashed immediately and never stored/logged, or a
// pre-computed otpHash), a signature ref, or a photo ref. Recording a
// handover (handedOverPoisha) is a separate explicit action on a
// DELIVERED delivery and flags any shortage instead of adjusting it away.

export async function GET() {
  const guard = await requireRiderAdmin("riders.view");
  if (!guard.ok) return NextResponse.json(riderGuardError(guard), { status: guard.status });
  const deliveries = await riderStore.listDeliveries();
  return NextResponse.json({
    data: {
      deliveries,
      codHandover: deliveries.filter((d) => d.status === "DELIVERED").map(codHandoverLine),
    },
    meta: { persistence: "database" },
  });
}

const handoverSchema = z.object({
  deliveryId: z.string().min(1),
  handedOverPoisha: z.number().int().nonnegative(),
});

export async function PATCH(req: Request) {
  const guard = await requireRiderAdmin("riders.manage");
  if (!guard.ok) return NextResponse.json(riderGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));

  // Handover action: { deliveryId, handedOverPoisha } with no transition target.
  const handover = handoverSchema.safeParse(body);
  const raw = body as { to?: unknown };
  if (handover.success && raw.to === undefined) {
    const delivery = await riderStore.getDelivery(handover.data.deliveryId);
    if (!delivery) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Delivery not found." } }, { status: 404 });
    }
    try {
      const updated = recordCodHandover(delivery, handover.data.handedOverPoisha);
      await riderStore.replaceDelivery(updated);
      return NextResponse.json({
        data: { delivery: updated, codHandover: codHandoverLine(updated) },
        meta: { persistence: "database" },
      });
    } catch (err) {
      return NextResponse.json(
        { error: { code: "INVALID_HANDOVER", message: err instanceof Error ? err.message : "Invalid handover." } },
        { status: 422 },
      );
    }
  }

  const parsed = deliveryTransitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid transition.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const delivery = await riderStore.getDelivery(parsed.data.deliveryId);
  if (!delivery) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Delivery not found." } }, { status: 404 });
  }
  const now = new Date().toISOString();
  let proof: DeliveryProof | undefined;
  if (parsed.data.to === "DELIVERED") {
    if (parsed.data.otpCode) proof = { kind: "OTP", otpHash: hashDeliveryOtp(parsed.data.otpCode), capturedAt: now };
    else if (parsed.data.otpHash) proof = { kind: "OTP", otpHash: parsed.data.otpHash, capturedAt: now };
    else if (parsed.data.signatureRef) proof = { kind: "SIGNATURE", signatureRef: parsed.data.signatureRef, capturedAt: now };
    else if (parsed.data.photoRef) proof = { kind: "PHOTO", photoRef: parsed.data.photoRef, capturedAt: now };
    else {
      return NextResponse.json(
        { error: { code: "PROOF_REQUIRED", message: "DELIVERED requires an OTP code/hash, signatureRef, or photoRef." } },
        { status: 400 },
      );
    }
  }
  try {
    const updated = applyDeliveryTransition(delivery, {
      to: parsed.data.to,
      at: now,
      proof,
      failureReason: parsed.data.failureReason,
      collectedPoisha: parsed.data.collectedPoisha,
    });
    await riderStore.replaceDelivery(updated);
    // If the rider has no more in-flight parcels, they are simply ACTIVE again.
    const rider = await riderStore.getRider(updated.riderId);
    if (rider && rider.status === "ON_DELIVERY") {
      const stillBusy = (await riderStore.listDeliveries(rider.id)).some(
        (d) => d.status === "ASSIGNED" || d.status === "PICKED_UP",
      );
      if (!stillBusy) await riderStore.replaceRider({ ...rider, status: "ACTIVE" });
    }
    return NextResponse.json({
      data: { delivery: updated, codHandover: updated.status === "DELIVERED" ? codHandoverLine(updated) : undefined },
      meta: { persistence: "database" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "INVALID_TRANSITION", message: err instanceof Error ? err.message : "Invalid transition." } },
      { status: 422 },
    );
  }
}
