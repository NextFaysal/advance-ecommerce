// Sandbox payment attempts list — Agent 9.
// GET /api/v1/admin/payments/sandbox (payments.view)
// Returns simulated attempts only. No credential, signature, or secret is
// ever included — attempts do not carry any.
// Persistence: attempts are DB-backed (payment_attempts). The webhook
// log in meta stays process-local: the schema has no webhook_logs table
// (see src/integrations/sandbox/store.ts).
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import { listAttempts } from "@/integrations/sandbox/db-store";
import { webhookMemory } from "@/integrations/sandbox/store";

export async function GET() {
  const guard = await requireAdminPermission("payments.view");
  if (!guard.ok) {
    return NextResponse.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.httpStatus },
    );
  }
  return NextResponse.json({
    data: await listAttempts(),
    meta: { sandbox: true, persistence: "database", webhookLog: webhookMemory.log },
  });
}
