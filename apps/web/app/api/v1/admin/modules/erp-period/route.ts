/**
 * ERP Period Lock / Unlock API — /api/v1/admin/modules/erp-period
 *
 * Manages accounting period locks (ErpPeriod table).
 * RBAC: reports.accounting
 */
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { prisma } from "@advance-ecommerce/db";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  try {
    const periods = await prisma.erpPeriod.findMany({
      orderBy: { code: "desc" },
      take: 24,
    });
    return NextResponse.json({ data: periods });
  } catch (e) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: "Failed to load accounting periods." } },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const { period, action } = (body || {}) as { period?: string; action?: "lock" | "unlock" };

  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json(
      { error: { code: "INVALID_PERIOD", message: "Period code must be YYYY-MM." } },
      { status: 400 },
    );
  }

  const [year, month] = period.split("-").map(Number);
  const startsOn = new Date(Date.UTC(year as number, (month as number) - 1, 1));
  const endsOn = new Date(Date.UTC(year as number, month as number, 0));

  try {
    const isLocking = action !== "unlock";
    const lockedAt = isLocking ? new Date() : null;

    const row = await prisma.erpPeriod.upsert({
      where: { code: period },
      update: { lockedAt },
      create: { code: period, startsOn, endsOn, lockedAt },
    });

    await writeAudit({
      actorId: guard.userId,
      action: isLocking ? "erp.period.lock" : "erp.period.unlock",
      entityType: "ErpPeriod",
      entityId: row.id,
      afterJson: { code: period, lockedAt },
      reason: isLocking ? `Accounting period ${period} locked` : `Accounting period ${period} unlocked`,
    });

    return NextResponse.json({ data: row });
  } catch (e) {
    console.error("[ERP Period Lock Error]", e);
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: "Failed to update period state." } },
      { status: 500 },
    );
  }
}
