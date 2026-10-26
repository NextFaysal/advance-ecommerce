import { NextResponse } from "next/server";
import { z } from "zod";
import { loadSmsDevices, revokeSmsDevice, toSmsDeviceView } from "@/bd/devices";
import { writeAudit } from "@/lib/audit";
import { guardError, requireAdmin } from "@/reports/guard";

// Revoke one SMS forwarder device token — wave 58 server companion.
// POST /api/v1/admin/bd/devices/<id>/revoke { reason }
// RBAC payments.verify_manual. Revocation is effective on the very
// next ingest request: device auth reads the `bd.sms_devices` doc
// directly from the database (no settings cache in the way —
// src/bd/devices.ts). Audited as bd.sms_device.revoke with
// hash-free before/after views. Unknown id -> 404; already revoked
// -> 409 (a silent no-op would let staff believe a live token died).

const revokeSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required."),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("payments.verify_manual");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = revokeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid revoke request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const existing = (await loadSmsDevices()).find((d) => d.id === params.id);
  if (!existing) {
    return NextResponse.json(
      { error: { code: "DEVICE_NOT_FOUND", message: "No such SMS forwarder device." } },
      { status: 404 },
    );
  }
  if (existing.revokedAt) {
    return NextResponse.json(
      { error: { code: "DEVICE_ALREADY_REVOKED", message: "This device is already revoked." } },
      { status: 409 },
    );
  }
  const before = toSmsDeviceView(existing);
  let revoked: Awaited<ReturnType<typeof revokeSmsDevice>>;
  try {
    revoked = await revokeSmsDevice(params.id, guard.userId);
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Device could not be revoked (database error)." } },
      { status: 503 },
    );
  }
  if (!revoked) {
    // Lost a race with a concurrent revoke between the check and
    // the write — report it as the already-revoked state it is.
    return NextResponse.json(
      { error: { code: "DEVICE_ALREADY_REVOKED", message: "This device is already revoked." } },
      { status: 409 },
    );
  }
  const view = toSmsDeviceView(revoked);
  await writeAudit({
    actorId: guard.userId,
    action: "bd.sms_device.revoke",
    entityType: "SmsDevice",
    entityId: revoked.id,
    beforeJson: { ...before },
    afterJson: { ...view },
    reason: parsed.data.reason,
  });
  return NextResponse.json({ data: { device: view }, meta: { persistence: "setting-doc" } });
}
