import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { listLoginAlerts } from "@/security/login-alerts";

// Suspicious-login alerts (ADV-28) — newest first.
// RBAC: audit.view, the same oversight permission as the audit log
// (the session route under admin/auth is session-only because it
// exposes the caller's OWN identity; this ledger spans all staff
// accounts, so it takes the permission gate like the audit log).
// Persistence: the `security.login_alerts` Setting doc via Prisma
// (see src/security/login-alerts.ts). The alerts are heuristics —
// prompts for human review, not proof of an attack.
export async function GET() {
  const guard = await requireAdmin("audit.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const alerts = await listLoginAlerts();
  return NextResponse.json({
    data: alerts,
    meta: {
      persistence: "database",
      source: "security.login_alerts Setting doc via Prisma",
      note: "Heuristic alerts only: account lockouts, failure bursts (5 failed attempts in 15 minutes), and successful logins from an IP the account has never used. Review before acting — travel, VPNs and shared office IPs trip these too.",
    },
  });
}
