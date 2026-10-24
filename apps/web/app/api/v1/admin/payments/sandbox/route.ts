// Sandbox payment attempts list — Agent 9.
// GET /api/v1/admin/payments/sandbox (payments.view)
// Returns simulated attempts only. No credential, signature, or secret is
// ever included — attempts do not carry any.
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import { sandboxStore } from "@/integrations/sandbox/store";

export async function GET() {
  const guard = await requireAdminPermission("payments.view");
  if (!guard.ok) {
    return NextResponse.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.httpStatus },
    );
  }
  return NextResponse.json({
    data: [...sandboxStore.payments.values()],
    meta: { sandbox: true, webhookLog: sandboxStore.webhookLog },
  });
}
