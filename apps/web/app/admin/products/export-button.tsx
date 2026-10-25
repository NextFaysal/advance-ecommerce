"use client";

import { useState } from "react";

// CSV export for the products list — small client leaf (plain
// serializable props only), mirroring the call-center reports export
// button. The API requires a reason and audit-logs the export
// (action "products.export"); this leaf collects the reason, downloads
// the returned CSV, and surfaces server errors verbatim.
//
// `status` is the list page's loaded status context: the page loads
// every status, so the default export covers ALL statuses. A specific
// status can be passed to export just that slice.
export function ProductsExportButton({ status = "ALL" }: { status?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("কারণ লেখা বাধ্যতামূলক। (A reason is required.)");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const params = new URLSearchParams({ status, reason: trimmed });
      const res = await fetch(`/api/v1/admin/products/export?${params.toString()}`);
      const body = (await res.json().catch(() => null)) as
        | { data?: { csv: string; filename: string; rowCount: number }; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.data) {
        setError(body?.error?.message ?? `Export failed (${res.status}).`);
        return;
      }
      const blob = new Blob([body.data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = body.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(
        `এক্সপোর্ট ডাউনলোড হয়েছে (${body.data.rowCount} সারি) — অডিট লগে নথিভুক্ত। (Exported; recorded in the audit log.)`,
      );
      setOpen(false);
      setReason("");
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন। (Network error.)");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {open ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="এক্সপোর্টের কারণ (বাধ্যতামূলক)"
            className="h-10 w-64 rounded-md border border-border bg-surface px-3 text-sm"
            aria-label="Export reason"
          />
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "হচ্ছে…" : "ডাউনলোড"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-border px-3 text-sm"
          >
            বাতিল
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-semibold shadow-card transition motion-fast hover:shadow-lift"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          CSV এক্সপোর্ট
        </button>
      )}
      {message ? <p className="text-xs text-emerald-600">{message}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
