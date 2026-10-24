import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { buildQueueCatalogue, workerStatus } from "./catalogue";

// Queue monitor — Agent 55. RBAC: settings.view (reports guard pattern,
// fail-closed: 401 without a session, 503 PRISMA_PENDING while session
// validation still needs the generated Prisma client).
//
// HONEST BY DESIGN: this returns the CONFIGURED queue system only —
// names, purposes, retry policies and handlers derived from
// src/jobs/queues.ts + src/jobs/workers.ts. There is no running BullMQ
// daemon (bullmq/ioredis are not installed; workers.ts is a wiring
// layer), so the worker status says exactly that and liveCounts is
// null. No job counts are ever invented here.

export async function GET() {
  const guard = await requireAdmin("settings.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  return NextResponse.json({
    data: {
      worker: workerStatus(),
      queues: buildQueueCatalogue(),
    },
    meta: {
      source: "configured-catalogue",
      liveCounts: null,
      note: "Queue policies are read from src/jobs contracts. Live job counts are unavailable until the BullMQ worker daemon runs (see worker.unblockSteps).",
    },
  });
}
