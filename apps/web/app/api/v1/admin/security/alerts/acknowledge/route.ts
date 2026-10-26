import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { acknowledgeLoginAlert } from "@/security/login-alerts";

// Acknowledge one suspicious-login alert (ADV-28) — marks it reviewed
// in the `security.login_alerts` Setting doc and returns the updated
// alert. RBAC: audit.view (same as the list route). Unknown id -> 404.
const bodySchema = z.object({
  id: z.string().min(1).max(120),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("audit.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "An alert id is required." } },
      { status: 400 },
    );
  }

  const alert = await acknowledgeLoginAlert(parsed.data.id);
  if (alert === null) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Login alert not found." } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    data: { alert },
    meta: {
      persistence: "database",
      source: "security.login_alerts Setting doc via Prisma",
    },
  });
}
