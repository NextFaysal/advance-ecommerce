import { QUEUE_NAMES, type QueueName } from "@/jobs/queues";
import { workerManifest } from "@/jobs/workers";

// Queue monitor catalogue — Agent 55.
//
// TRUTHFUL BY CONSTRUCTION: every number here (attempts, backoff,
// concurrency) is read live from workerManifest() in src/jobs/workers.ts,
// which derives it from RETRY_POLICY_BY_QUEUE / CONCURRENCY_BY_QUEUE over
// QUEUE_NAMES in src/jobs/queues.ts. Nothing is hardcoded twice, and NO
// job counts exist here — there is no running BullMQ daemon to count
// from (see workerStatus() below), so liveCounts is null, never a number.
//
// The only hand-written part is QUEUE_PRESENTATION (handler names +
// bilingual purposes). KEEP IN SYNC with src/jobs/handlers.ts: the
// handler names are the const names inside createHandlers(), keyed there
// by the same QUEUE_NAMES values. The Record<QueueName, ...> type makes
// a missing queue a compile error, so drift fails the typecheck.

export interface QueuePresentation {
  /** Const name of the handler inside createHandlers() in handlers.ts. */
  handlerName: string;
  purposeBn: string;
  purposeEn: string;
}

const QUEUE_PRESENTATION: Record<QueueName, QueuePresentation> = {
  [QUEUE_NAMES.sms]: {
    handlerName: "sms",
    purposeBn: "SMS পাঠানো — অর্ডার আপডেট ও নোটিফিকেশন",
    purposeEn: "Send SMS via the admin-configured provider (sandbox fallback locally)",
  },
  [QUEUE_NAMES.email]: {
    handlerName: "email",
    purposeBn: "ইমেইল পাঠানো",
    purposeEn: "Send email via the admin-configured provider (sandbox fallback locally)",
  },
  [QUEUE_NAMES.courierBooking]: {
    handlerName: "courierBooking",
    purposeBn: "কুরিয়ার বুকিং",
    purposeEn: "Book a courier shipment through the provider adapter (payload carries ids only)",
  },
  [QUEUE_NAMES.courierSync]: {
    handlerName: "courierSync",
    purposeBn: "কুরিয়ার স্ট্যাটাস সিঙ্ক",
    purposeEn: "Sync shipment status from the courier provider",
  },
  [QUEUE_NAMES.webhook]: {
    handlerName: "webhook",
    purposeBn: "ওয়েবহুক ডেলিভারি",
    purposeEn: "Fan out domain events to webhook subscribers",
  },
  [QUEUE_NAMES.importExport]: {
    handlerName: "importExport",
    purposeBn: "CSV ইমপোর্ট / এক্সপোর্ট",
    purposeEn: "Run product / order / customer CSV imports and exports",
  },
  [QUEUE_NAMES.report]: {
    handlerName: "report",
    purposeBn: "রিপোর্ট তৈরি",
    purposeEn: "Generate report files (sales / product / customer / courier / district / P&L)",
  },
  [QUEUE_NAMES.notificationRetry]: {
    handlerName: "notificationRetry",
    purposeBn: "ব্যর্থ নোটিফিকেশন আবার পাঠানো",
    purposeEn: "Retry a failed notification log entry",
  },
  [QUEUE_NAMES.abandonedCart]: {
    handlerName: "abandonedCart",
    purposeBn: "ঝুলে থাকা কার্টের ফলো-আপ",
    purposeEn: "Abandoned-cart follow-up steps 1-3 (sends go through the SMS/email queues)",
  },
  [QUEUE_NAMES.automation]: {
    handlerName: "automation",
    purposeBn: "অটোমেশন রুল চালানো",
    purposeEn: "Run automation rules for a trigger event",
  },
  [QUEUE_NAMES.bulkActions]: {
    // No createHandlers() entry yet: the processor is processBulkJob in
    // src/jobs/bulk-actions.ts (runs in-process in demo; the BullMQ
    // handler will call the same function).
    handlerName: "processBulkJob (src/jobs/bulk-actions.ts)",
    purposeBn: "একসাথে অনেক অর্ডারের কাজ — কনফার্ম / লেবেল / কুরিয়ার বুকিং",
    purposeEn: "Bulk order actions (confirm / print label / book courier / status / tag) with per-order results",
  },
};

export interface QueueCatalogueEntry {
  queue: QueueName;
  handlerName: string;
  purposeBn: string;
  purposeEn: string;
  attempts: number;
  backoffSeconds: number;
  concurrency: number;
}

/** The configured queue catalogue — policies from workers.ts, live. */
export function buildQueueCatalogue(): QueueCatalogueEntry[] {
  return workerManifest().map((row) => {
    const presentation = QUEUE_PRESENTATION[row.queue];
    return {
      queue: row.queue,
      handlerName: presentation.handlerName,
      purposeBn: presentation.purposeBn,
      purposeEn: presentation.purposeEn,
      attempts: row.attempts,
      backoffSeconds: row.backoffSeconds,
      concurrency: row.concurrency,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Worker status — reports the wiring-layer state, nothing invented    */
/* ------------------------------------------------------------------ */

export interface WorkerStatus {
  daemon: "not_running";
  reason: "bullmq_not_installed";
  /** Always null in this build: no daemon means no counts to read. */
  liveCounts: null;
  detail: string;
  /** Exact unblock steps, from the header of src/jobs/workers.ts. */
  unblockSteps: readonly string[];
}

export function workerStatus(): WorkerStatus {
  return {
    daemon: "not_running",
    reason: "bullmq_not_installed",
    liveCounts: null,
    detail:
      "src/jobs/workers.ts is a wiring + policy layer only: bullmq/ioredis are not installed and no worker entrypoint exists, so no daemon is running and no live job counts can be read.",
    unblockSteps: [
      "Worker package-e `pnpm add bullmq ioredis` korte hobe",
      "REDIS_URL theke Redis connection banate hobe (server env only)",
      "createWorkers(deps, { Worker, Queue }, connection) real BullMQ constructor diye call korte hobe",
      "Worker process chaloo rakhte hobe ebong SIGTERM-e workers.close() handle korte hobe",
    ],
  };
}
