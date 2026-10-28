"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { CALL_CENTER_STRINGS } from "../strings";

// CSV export for the call-center report — small client leaf (plain
// serializable props only). The API requires a reason and audit-logs the
// export, mirroring the audit-log export; this leaf collects the reason,
// downloads the returned CSV, and surfaces server errors verbatim.
export function ReportsExportButton({ from, to }: { from: string; to: string }) {
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(s.reasonRequired);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/v1/admin/call-center/reports/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&reason=${encodeURIComponent(trimmed)}`,
      );
      const body = (await res.json().catch(() => null)) as
        | { data?: { csv: string; filename: string }; error?: { message?: string } }
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
      setMessage(s.exportedMsg);
      setOpen(false);
      setReason("");
    } catch {
      setError(s.networkErrorRetry);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={s.exportReasonPlaceholder}
            className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm shadow-xs sm:w-64 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            aria-label={s.exportReasonAria}
          />
          <Button
            type="button"
            onClick={run}
            disabled={busy}
          >
            {busy ? s.downloadingText : s.downloadBtn}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            {s.cancelBtn}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
        >
          {s.csvExportBtn}
        </Button>
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
