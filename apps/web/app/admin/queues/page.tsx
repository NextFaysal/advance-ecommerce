import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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

export default function QueuesPage() {
  const worker = workerStatus();
  const queues = buildQueueCatalogue();

  const queueRows = queues.map((q) => ({
    queue: <span className="font-mono text-[13px]">{q.queue}</span>,
    purpose: (
      <span>
        <span className="block">{q.purposeBn}</span>
        <span className="block text-xs text-text-muted">{q.purposeEn}</span>
      </span>
    ),
    retry: `${q.attempts} বার চেষ্টা · ${q.backoffSeconds} সে. ব্যবধান (exponential)`,
    concurrency: String(q.concurrency),
    handler: <span className="font-mono text-[13px]">{q.handlerName}</span>,
  }));

  return (
    <main>
      <PageHeader
        title="কিউ মনিটর"
        description="Queue Monitor — ব্যাকগ্রাউন্ড জব সিস্টেমের কনফিগার করা অবস্থা (লাইভ কাউন্ট এখনো পাওয়া যাচ্ছে না)"
        breadcrumb="সিস্টেম / কিউ মনিটর"
      />

      {/* Worker status — the daemon truthfully is not running. */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">ওয়ার্কার স্ট্যাটাস</h2>
          <Badge tone="danger">✕ ডেমন চলছে না (daemon: not_running)</Badge>
          <Badge tone="neutral">কারণ: bullmq_not_installed</Badge>
        </div>
        <p className="mt-3 text-sm text-text-muted">
          <span className="font-mono text-[13px]">src/jobs/workers.ts</span> এখন শুধু
          wiring + policy layer — <span className="font-mono text-[13px]">bullmq</span>/
          <span className="font-mono text-[13px]">ioredis</span> ইনস্টল করা নেই এবং কোনো
          worker entrypoint নেই। তাই কোনো ডেমন চলছে না এবং লাইভ জব কাউন্ট পড়া যাচ্ছে না
          (<span className="font-mono text-[13px]">liveCounts: null</span>) — এই পেজে
          কোনো উদ্ভাবিত সংখ্যা দেখানো হয় না।
        </p>
        <h3 className="mt-4 text-sm font-semibold">চালু করতে যা লাগবে (workers.ts অনুযায়ী)</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-text-muted">
          {worker.unblockSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Card>

      {/* Configured queue catalogue — policies read from the contracts. */}
      <DataTable
        caption={`কনফিগার করা কিউ — মোট ${queues.length}টি (নীতি: src/jobs/queues.ts + workers.ts)`}
        columns={[
          { key: "queue", header: "কিউ (Queue)" },
          { key: "purpose", header: "উদ্দেশ্য (Purpose)" },
          { key: "retry", header: "রিট্রাই নীতি (Retry)" },
          { key: "concurrency", header: "Concurrency" },
          { key: "handler", header: "হ্যান্ডলার (handlers.ts)" },
        ]}
        rows={queueRows}
      />

      {/* Payload safety — the rule written in queues.ts itself. */}
      <Card className="mt-6">
        <h2 className="text-base font-semibold">পেলোড নিরাপত্তা</h2>
        <p className="mt-2 text-sm text-text-muted">
          প্রতিটি জবের পেলোডে শুধু ID আর masked reference থাকে —
          <span className="font-mono text-[13px]"> src/jobs/queues.ts</span>-এর নিয়ম
          অনুযায়ী পেলোড বা লগে কোনো secret অথবা পুরো ফোন নম্বর plain text-এ রাখা
          নিষেধ। হ্যান্ডলাররা শুধু id, template key, provider-এর নাম আর masked ref
          লগ করে (<span className="font-mono text-[13px]">src/jobs/handlers.ts</span>)।
        </p>
      </Card>

      {/* Recent jobs — honest empty state, never fake rows. */}
      <div className="mt-6">
        <EmptyState
          title="সাম্প্রতিক জব"
          description="লাইভ ডেটা নেই — worker চালু হলে এখানে job দেখা যাবে"
        />
      </div>
    </main>
  );
}
