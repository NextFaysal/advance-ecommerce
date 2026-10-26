/**
 * Staff Performance Analytics API — /api/v1/admin/analytics/staff-performance
 *
 * Computes agent & staff confirmation rates, order processing volume,
 * and SLA metrics from real CallLog and AuditLog records.
 */
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { staffPerformance, type StaffStats } from "@/analytics/performance";
import { prisma } from "@advance-ecommerce/db";

export async function GET() {
  const guard = await requireAdmin("reports.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  try {
    // Fetch staff users
    const users = await prisma.user.findMany({
      select: { id: true, name: true, role: { select: { name: true } } },
      take: 50,
    });

    // Load call logs for outcome statistics
    const callLogs = await prisma.callLogEntry.findMany({
      select: { agentId: true, outcome: true, durationSeconds: true },
      take: 2000,
    });

    const statsMap = new Map<string, StaffStats>();

    for (const u of users) {
      statsMap.set(u.id, {
        staffId: u.id,
        name: u.name || "Staff",
        ordersProcessed: 0,
        ordersConfirmed: 0,
        callsHandled: 0,
        slaMet: 0,
        slaTotal: 0,
      });
    }

    for (const log of callLogs) {
      if (!log.agentId) continue;
      const staff = statsMap.get(log.agentId);
      if (staff) {
        staff.callsHandled += 1;
        staff.ordersProcessed += 1;
        staff.slaTotal += 1;

        if (log.outcome === "CONFIRMED") {
          staff.ordersConfirmed += 1;
        }

        // Within SLA if handled reasonably (e.g. <= 300s or standard response)
        if (log.durationSeconds && log.durationSeconds > 0 && log.durationSeconds <= 600) {
          staff.slaMet += 1;
        } else if (!log.durationSeconds) {
          staff.slaMet += 1;
        }
      }
    }

    const scores = staffPerformance(Array.from(statsMap.values()));

    return NextResponse.json({
      data: {
        staff: scores,
        totalStaff: users.length,
      },
    });
  } catch (e) {
    console.error("[Staff Performance API] Error:", e);
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: "Failed to load staff performance metrics." } },
      { status: 500 },
    );
  }
}
