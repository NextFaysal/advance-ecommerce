"use client";

// Bulk action bar for the admin order list — selection lives in the list
// page; this bar sends ONE request to the bulk endpoint
// (POST /api/v1/admin/orders) and then polls the job status endpoint
// (GET /api/v1/admin/jobs/[id]) until the job settles, showing the API's
// own per-order outcomes. The endpoint registers a REAL job processed
// in-process by processBulkJob (the same function the future BullMQ
// worker will run): confirm goes through the state machine, print
// produces a payload only, courier booking is SANDBOX-only — the job's
// per-order results say so, and the bar repeats them verbatim. It never
// claims more than the API reports.
import { useState } from "react";
import { Button } from "../../components/ui/button";

export type BulkAction = "confirm" | "print_label" | "book_courier";

type BulkApiResponse =
  | { data: { jobId: string; action: string; orderIds: string[]; status: string }; meta?: { note?: string } }
  | { error: { code: string; message: string; details?: unknown } };

type JobResponse =
  | {
      data: {
        status: string;
        perOrderResults: { orderId: string; ok: boolean; code?: string; message?: string }[];
      };
    }
  | { error: { code: string; message: string } };

const ACTION_LABEL_BN: Record<BulkAction, string> = {
  confirm: "বাল্ক কনফার্ম",
  print_label: "বাল্ক লেবেল প্রিন্ট",
  book_courier: "বাল্ক কুরিয়ার বুকিং",
};

const TERMINAL_JOB_STATUSES = new Set(["COMPLETED", "COMPLETED_WITH_FAILURES", "FAILED"]);

export function BulkActionBar({
  selectedIds,
  onClear,
  onDone,
}: {
  selectedIds: string[];
  onClear: () => void;
  /** Called after a job settles so the parent list can refetch. */
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState<BulkAction | null>(null);
  const [result, setResult] = useState<string>("");

  if (selectedIds.length === 0) return null;

  async function pollJob(jobId: string): Promise<string> {
    // The processor runs in-process on a microtask; poll briefly for the
    // settled state, then report whatever the job endpoint says.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const res = await fetch(`/api/v1/admin/jobs/${jobId}`);
        const body = (await res.json().catch(() => null)) as JobResponse | null;
        if (body && "data" in body) {
          const okCount = body.data.perOrderResults.filter((r) => r.ok).length;
          const failCount = body.data.perOrderResults.length - okCount;
          if (TERMINAL_JOB_STATUSES.has(body.data.status)) {
            return `জব ${body.data.status}: ${okCount}টি সফল${failCount > 0 ? `, ${failCount}টি ব্যর্থ` : ""}।`;
          }
        }
      } catch {
        // Polling is best-effort; the summary below still reports the job id.
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    return "জব এখনো প্রসেস হচ্ছে — ফলাফল Jobs API-তে পাওয়া যাবে।";
  }

  async function run(action: BulkAction) {
    setBusy(action);
    setResult("");
    try {
      const res = await fetch("/api/v1/admin/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, orderIds: selectedIds }),
      });
      const body = (await res.json().catch(() => null)) as BulkApiResponse | null;
      if (body && "data" in body) {
        const summary = await pollJob(body.data.jobId);
        setResult(
          `${ACTION_LABEL_BN[action]} — জব তৈরি হয়েছে (${body.data.jobId}, HTTP ${res.status})। ${summary} ${body.meta?.note ?? ""}`,
        );
        onDone?.();
      } else if (body && "error" in body) {
        setResult(`${ACTION_LABEL_BN[action]} — API উত্তর: HTTP ${res.status} · ${body.error.code}: ${body.error.message}`);
      } else {
        setResult(`${ACTION_LABEL_BN[action]} — API উত্তর: HTTP ${res.status} (অপ্রত্যাশিত উত্তর)।`);
      }
    } catch {
      setResult(`${ACTION_LABEL_BN[action]} — API-তে পৌঁছানো যায়নি (নেটওয়ার্ক)। কিছুই পাঠানো হয়নি।`);
    }
    setBusy(null);
  }

  return (
    <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{selectedIds.length}টি অর্ডার সিলেক্ট করা হয়েছে</p>
        {(Object.keys(ACTION_LABEL_BN) as BulkAction[]).map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={action === "book_courier" ? "primary" : "outline"}
            loading={busy === action}
            disabled={busy !== null}
            onClick={() => void run(action)}
          >
            {ACTION_LABEL_BN[action]}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={onClear}>
          সিলেকশন মুছুন
        </Button>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        বাল্ক API একটি আসল জব তৈরি করে (202) — কনফার্ম স্টেট মেশিন দিয়ে DB-তে সংরক্ষিত হয়, কুরিয়ার বুকিং
        <strong> SANDBOX</strong>-only, প্রিন্ট শুধু পেলোড। প্রতি-অর্ডার ফলাফল Jobs API থেকে দেখানো হয়।
      </p>
      {result && (
        <p role="status" className="mt-2 text-sm">
          {result}
        </p>
      )}
    </div>
  );
}
