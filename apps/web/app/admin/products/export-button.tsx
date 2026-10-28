"use client";

import { useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { PRODUCTS_STRINGS } from "./strings";

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
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(s.exportReasonRequired);
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
        setError(body?.error?.message ?? interpolate(s.exportFailed, { status: res.status }));
        return;
      }
      const blob = new Blob([body.data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = body.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(interpolate(s.exportSuccess, { count: body.data.rowCount }));
      setOpen(false);
      setReason("");
    } catch {
      setError(s.exportNetwork);
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
            placeholder={s.exportReasonPh}
            className="h-11 w-64 max-w-[70vw] rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition duration-base ease-smooth focus:border-brand-ink focus:ring-[3px] focus:ring-brand-ink/15"
            aria-label={s.exportReasonAria}
          />
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:brightness-105 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            {busy ? s.exportBusy : s.exportDownload}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border bg-card px-3 text-sm font-medium shadow-xs transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-soft"
          >
            {s.cancelBtn}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 text-sm font-semibold shadow-xs transition duration-fast ease-smooth hover:shadow-lift"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          {s.exportBtn}
        </button>
      )}
      {message ? <p className="text-xs text-success-solid">{message}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
