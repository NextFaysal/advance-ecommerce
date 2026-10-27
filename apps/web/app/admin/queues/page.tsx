import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { QUEUES_STRINGS } from "./strings";
import {
  buildQueueCatalogue,
  workerStatus,
} from "../../api/v1/admin/queues/catalogue";

// Queue Monitor admin — Agent 55 (Audit v2 gap: queue monitor absent).
// HONEST PAGE: this shows the CONFIGURED job system only. The catalogue
// (names, retry policies, concurrency, handlers) is derived live from
// src/jobs/queues.ts + src/jobs/workers.ts via the same builder the
// GET /api/v1/admin/queues route uses. There is NO live Redis/BullMQ
// behind it — bullmq/ioredis are not installed and workers.ts is a
// wiring layer, not a daemon — so the worker card says the daemon is
// not running and the recent-jobs panel is an honest empty state.
// No job counts are shown anywhere, because none can be read.

export default async function QueuesPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, QUEUES_STRINGS);
  const worker = workerStatus();
  const queues = buildQueueCatalogue();

  const queueRows = queues.map((q) => ({
    queue: <span className="font-mono text-[13px]">{q.queue}</span>,
    purpose: <span>{locale === "bn" ? q.purposeBn : q.purposeEn}</span>,
    retry: interpolate(s.retryTemplate, { attempts: q.attempts, backoff: q.backoffSeconds }),
    concurrency: String(q.concurrency),
    handler: <span className="font-mono text-[13px]">{q.handlerName}</span>,
  }));

  return (
    <main>
      <PageHeader title={s.title} description={s.description} breadcrumb={s.breadcrumb} />

      {/* Worker status — the daemon truthfully is not running. */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">{s.workerStatus}</h2>
          <Badge tone="danger">{s.daemonBadge}</Badge>
          <Badge tone="neutral">{s.reasonBadge}</Badge>
        </div>
        <p className="mt-3 text-sm text-text-muted">
          <span className="font-mono text-[13px]">src/jobs/workers.ts</span>
          {s.workerBody1}
          <span className="font-mono text-[13px]">bullmq</span>
          {s.workerBody2}
          <span className="font-mono text-[13px]">ioredis</span>
          {s.workerBody3}
          <span className="font-mono text-[13px]">liveCounts: null</span>
          {s.workerBody4}
        </p>
        <h3 className="mt-4 text-sm font-semibold">{s.unblockHeading}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-text-muted">
          {worker.unblockSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Card>

      {/* Configured queue catalogue — policies read from the contracts. */}
      <DataTable
        caption={interpolate(s.caption, { count: queues.length })}
        columns={[
          { key: "queue", header: s.colQueue },
          { key: "purpose", header: s.colPurpose },
          { key: "retry", header: s.colRetry },
          { key: "concurrency", header: s.colConcurrency },
          { key: "handler", header: s.colHandler },
        ]}
        rows={queueRows}
      />

      {/* Payload safety — the rule written in queues.ts itself. */}
      <Card className="mt-6">
        <h2 className="text-base font-semibold">{s.payloadTitle}</h2>
        <p className="mt-2 text-sm text-text-muted">
          {s.payloadBody1}
          <span className="font-mono text-[13px]"> src/jobs/queues.ts</span>
          {s.payloadBody2}
          <span className="font-mono text-[13px]">src/jobs/handlers.ts</span>
          {s.payloadBody3}
        </p>
      </Card>

      {/* Recent jobs — honest empty state, never fake rows. */}
      <div className="mt-6">
        <EmptyState title={s.recentTitle} description={s.recentDesc} />
      </div>
    </main>
  );
}
