"use client";

/**
 * Vendor payout panel (schema wave 2) — mirrors the reseller admin
 * payout list (app/admin/resellers/payout-actions.tsx): every
 * request across vendors with approve → mark-paid / reject buttons
 * + an optional note the vendor can see. PAID is a RECORD that
 * staff paid the vendor externally (bKash/Nagad/bank) — labelled as
 * such everywhere; this panel never sends money.
 */
import { useCallback, useEffect, useState } from "react";
import { formatBdt } from "@/checkout/pricing";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick } from "@/i18n/locale";
import { VENDORS_STRINGS } from "./strings";

interface AdminVendorPayoutRow {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorPhoneMasked: string;
  amountPoisha: number;
  method: "BKASH" | "NAGAD" | "BANK";
  accountNote: string;
  status: "PENDING" | "APPROVED" | "PAID" | "REJECTED";
  note?: string;
  createdAt: string;
}



export default function VendorPayoutActions() {
  const { locale } = useLocale();
  const s = pick(locale, VENDORS_STRINGS);
  const STATUS_LABEL: Record<AdminVendorPayoutRow["status"], string> = { PENDING: s.payStatusPending, APPROVED: s.payStatusApproved, PAID: s.payStatusPaid, REJECTED: s.payStatusRejected };
  const [rows, setRows] = useState<AdminVendorPayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/vendors/payouts");
      const body = (await res.json().catch(() => ({}))) as {
        data?: { requests?: AdminVendorPayoutRow[] };
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(body.error?.message ?? s.payoutLoadFailed);
        setRows([]);
        return;
      }
      setRows(body.data?.requests ?? []);
    } catch {
      setError(s.payoutLoadFailedConn);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: AdminVendorPayoutRow, action: "APPROVED" | "PAID" | "REJECTED") {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/vendors/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payoutId: row.id,
          action,
          note: notes[row.id]?.trim() ? notes[row.id].trim().slice(0, 500) : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) setError(body.error?.message ?? s.decisionFailed);
      else await load();
    } catch {
      setError(s.decisionFailedConn);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-bold text-text-main">{s.payoutPanelTitle}</h2>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        {s.payoutPanelDesc}
      </p>
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {loading ? (
        <p className="mt-3 text-sm text-text-muted">{s.loading}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">{s.noPayouts}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-text-main">
                  {r.vendorName} · {formatBdt(r.amountPoisha)} · {r.method}
                </p>
                <span className="text-xs font-medium text-text-main">{STATUS_LABEL[r.status]}</span>
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {r.vendorPhoneMasked} · {new Date(r.createdAt).toLocaleString(intlLocale(locale))} · {interpolate(s.accountLabel, { note: r.accountNote })}
                {r.note ? <> · {interpolate(s.vendorNoteLabel, { note: r.note })}</> : null}
              </p>
              {r.status === "PENDING" || r.status === "APPROVED" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    placeholder={s.notePlaceholderPayout}
                    maxLength={500}
                    className="min-w-[220px] flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main"
                  />
                  {r.status === "PENDING" ? (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void decide(r, "APPROVED")}
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {s.approve}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void decide(r, "PAID")}
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {s.paidBtn}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void decide(r, "REJECTED")}
                    className="rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {s.rejectBtn}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
