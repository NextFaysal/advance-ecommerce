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

const STATUS_BN: Record<AdminVendorPayoutRow["status"], string> = {
  PENDING: "অপেক্ষমান",
  APPROVED: "অনুমোদিত",
  PAID: "পেইড (বাইরে পেমেন্ট রেকর্ড)",
  REJECTED: "প্রত্যাখ্যাত",
};

export default function VendorPayoutActions() {
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
        setError(body.error?.message ?? "পে-আউট তালিকা লোড করা যায়নি।");
        setRows([]);
        return;
      }
      setRows(body.data?.requests ?? []);
    } catch {
      setError("পে-আউট তালিকা লোড করা যায়নি — সংযোগ পরীক্ষা করুন।");
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
      if (!res.ok) setError(body.error?.message ?? "সিদ্ধান্ত সংরক্ষণ করা যায়নি।");
      else await load();
    } catch {
      setError("সিদ্ধান্ত সংরক্ষণ করা যায়নি — সংযোগ পরীক্ষা করুন।");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-bold text-text-main">ভেন্ডর পে-আউট অনুরোধ</h2>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        "পেইড" মানে স্টাফ ভেন্ডরকে সিস্টেমের বাইরে (বিকাশ/নগদ/ব্যাংক) পেমেন্ট করে এখানে রেকর্ড
        করেছেন — এই প্যানেল থেকে কোনো টাকা পাঠানো হয় না।
      </p>
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {loading ? (
        <p className="mt-3 text-sm text-text-muted">লোড হচ্ছে…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">এখনো কোনো পে-আউট অনুরোধ নেই।</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-text-main">
                  {r.vendorName} · {formatBdt(r.amountPoisha)} · {r.method}
                </p>
                <span className="text-xs font-medium text-text-main">{STATUS_BN[r.status]}</span>
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {r.vendorPhoneMasked} · {new Date(r.createdAt).toLocaleString("bn-BD")} · অ্যাকাউন্ট: {r.accountNote}
                {r.note ? <> · ভেন্ডরকে দেখানো নোট: {r.note}</> : null}
              </p>
              {r.status === "PENDING" || r.status === "APPROVED" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    placeholder="নোট (ঐচ্ছিক — ভেন্ডর দেখতে পাবেন)"
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
                      অনুমোদন
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void decide(r, "PAID")}
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      পেইড (বাইরে পেমেন্ট রেকর্ড)
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void decide(r, "REJECTED")}
                    className="rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    প্রত্যাখ্যান
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
