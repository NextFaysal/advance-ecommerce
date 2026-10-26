/**
 * Admin bulk job status — GET /api/v1/admin/jobs/[id] (Agent 63).
 *
 * Returns the bulk job registered by POST /api/v1/admin/orders with its
 * per-order results (src/jobs/bulk-actions.ts). Guard: reports guard
 * pattern, requires orders.view, fail-closed (401 / 403 / 503
 * PRISMA_PENDING while the Prisma client is ungenerated).
 *
 * The registry is Redis-backed since ADV-10 (in-memory map as cache /
 * fallback): this read goes through getBulkJobAsync, so a job another
 * process registered or ran is visible here whenever the Redis
 * backend answers — meta.storeBackend says which backend answered.
 * Results never contain PII (order ids, status codes, SBX tracking
 * ids and payload refs only). Unknown id -> 404 JOB_NOT_FOUND.
 */
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { bulkJobStoreBackend, getBulkJobAsync } from "@/jobs/bulk-actions";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const job = await getBulkJobAsync(params.id);
  if (!job) {
    return NextResponse.json(
      { error: { code: "JOB_NOT_FOUND", message: "Bulk job not found." } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    data: job,
    meta: {
      source: "bulk-job-registry",
      storeBackend: await bulkJobStoreBackend(),
      processor: job.processor,
      queue: job.queue,
    },
  });
}
