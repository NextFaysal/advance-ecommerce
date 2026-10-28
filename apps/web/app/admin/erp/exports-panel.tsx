"use client";

/**
 * Tally / QuickBooks export panel (ADV-11 remainder) — a section on
 * the ERP page. Picks a business-date range, asks for a reason
 * (mandatory, audited server-side, and embedded in the file as an
 * XML comment / a leading `#` comment row), and downloads the POSTED
 * journal entries in that range as a Tally import XML or a QuickBooks
 * journal-import CSV.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { ERP_STRINGS } from "./strings";

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function monthStartYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export function ErpExportsPanel() {
  const { locale } = useLocale();
  const s = pick(locale, ERP_STRINGS);
  const [from, setFrom] = useState(monthStartYmd());
  const [to, setTo] = useState(todayYmd());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function download(kind: "tally" | "quickbooks") {
    setError(null);
    setNotice(null);
    if (reason.trim() === "") {
      setError(s.exReasonRequired);
      return;
    }
    if (!from || !to || from > to) {
      setError(s.exBadRange);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/modules/erp-exports/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, reason: reason.trim() }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
        setError(json.error?.message ?? s.exFailed);
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? (kind === "tally" ? "tally-journal.xml" : "quickbooks-journal.csv");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(href);
      setNotice(interpolate(s.exDownloaded, { filename }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-semibold">{s.exTitle}</h2>
          <p className="max-w-3xl text-sm text-text-muted">
            {s.exDescBefore}<code className="font-mono text-xs">#</code>{s.exDescAfter}
          </p>
        </div>
        {error ? <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
        {notice ? <p className="rounded-xl bg-success-soft px-3 py-2 text-sm text-success-solid">{notice}</p> : null}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Input id="erp-export-from" type="date" label={s.exFromLabel} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Input id="erp-export-to" type="date" label={s.exToLabel} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="min-w-[220px] flex-1">
            <Input
              id="erp-export-reason"
              label={s.exReasonLabel}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={s.exReasonPlaceholder}
            />
          </div>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void download("tally")}
          >
            {s.exTallyBtn}
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void download("quickbooks")}
          >
            {s.exQbBtn}
          </Button>
        </div>
      </div>
    </Card>
  );
}
