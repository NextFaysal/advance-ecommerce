import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { prismaKeyValueStore } from "@/reports/saved-reports";
import { runDueReportSchedules } from "@/reports/schedule-delivery";
import { enqueueEmailJob } from "@/email/send";

// POST /api/v1/admin/reports/builder/schedules/run-due — evaluate all
// schedules once (ADV-8). Until the worker host (ADV-1) runs a
// periodic tick, THIS is the trigger: an admin (or an external cron
// with an admin session) calls it, due schedules enqueue their
// delivery email jobs, and only fully-queued schedules are marked
// sent. Enqueueing is not delivery — actual sending needs the worker
// + a configured email transport (ADV-3). RBAC: reports.export.
export async function POST() {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const outcomes = await runDueReportSchedules({
    store: prismaKeyValueStore(),
    enqueue: (job, name) => enqueueEmailJob(job, name),
    now: new Date(),
    actorId: guard.userId,
  });
  return NextResponse.json({
    data: { outcomes },
    meta: { source: "database", note: "Queued jobs deliver when the worker runs with a configured email transport." },
  });
}
