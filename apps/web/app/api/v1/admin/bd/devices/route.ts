import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SmsDeviceLimitError,
  createSmsDevice,
  loadSmsDevices,
  toSmsDeviceView,
} from "@/bd/devices";
import { writeAudit } from "@/lib/audit";
import { guardError, requireAdmin } from "@/reports/guard";

// SMS forwarder device tokens — wave 58 server companion.
// Storage: the `bd.sms_devices` Setting doc (hashes only —
// src/bd/devices.ts). The plaintext token exists ONLY in the POST
// response below, returned once for staff to pair the phone; no
// read path ever returns a token or a token hash.
// GET:  RBAC payments.verify_manual. Lists device views (label,
//       created, last seen, revoked state).
// POST: RBAC payments.verify_manual. Body { label, reason }.
//       Creates a device (max 20 active), audits
//       bd.sms_device.create with the hash-free view, and returns
//       { device, token } — the token is shown ONCE.

const createSchema = z.object({
  label: z.string().trim().min(1, "Label is required.").max(80),
  reason: z.string().trim().min(1, "Reason is required."),
});

export async function GET() {
  const guard = await requireAdmin("payments.verify_manual");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const devices = await loadSmsDevices();
  return NextResponse.json({
    data: { devices: devices.map(toSmsDeviceView) },
    meta: { persistence: "setting-doc" },
  });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("payments.verify_manual");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid device request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  let created: Awaited<ReturnType<typeof createSmsDevice>>;
  try {
    created = await createSmsDevice(parsed.data.label, guard.userId);
  } catch (err) {
    if (err instanceof SmsDeviceLimitError) {
      return NextResponse.json(
        { error: { code: "SMS_DEVICE_LIMIT", message: err.message } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Device could not be created (database error)." } },
      { status: 503 },
    );
  }
  const view = toSmsDeviceView(created.device);
  await writeAudit({
    actorId: guard.userId,
    action: "bd.sms_device.create",
    entityType: "SmsDevice",
    entityId: created.device.id,
    beforeJson: null,
    // The view carries no token and no hash — an audit record must
    // never become a credential store.
    afterJson: { ...view },
    reason: parsed.data.reason,
  });
  return NextResponse.json(
    {
      data: { device: view, token: created.token },
      meta: { persistence: "setting-doc", note: "The token is returned only in this response and is never stored or shown again." },
    },
    { status: 201 },
  );
}
