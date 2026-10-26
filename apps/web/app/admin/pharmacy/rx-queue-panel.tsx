"use client";

/**
 * Pharmacist verification queue panel (ADV-22) — self-fetching.
 * Lists orders whose prescription review is PENDING with the
 * customer's recorded prescription + Rx line items; the pharmacist
 * approves or rejects with a mandatory note. The decision API writes
 * the state + timeline note + audit; this panel only renders the
 * outcome honestly (a rejection does NOT cancel the order — it stays
 * un-confirmable until staff cancel it through the order flow).
 */
import { useCallback, useEffect, useState } from "react";

interface RxQueueRow {
  orderId: string;
  orderNo: string;
  status: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  totalPoisha: number;
  rxItems: Array<{ productName: string; sku: string; quantity: number }>;
  prescription: {
    prescriberName: string;
    registrationNo: string;
    imageUrl?: string | null;
    attested: boolean;
  } | null;
  queuedAt: string;
}

function formatBdt(poisha: number): string {
  return `৳${(poisha / 100).toLocaleString("bn-BD", { maximumFractionDigits: 2 })}`;
}

export function RxQueuePanel() {
  const [queue, setQueue] = useState<RxQueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/pharmacy/rx-queue");
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "কিউ লোড করা যায়নি।");
        return;
      }
      setQueue(json.data.queue as RxQueueRow[]);
      setError(null);
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: RxQueueRow, decision: "APPROVED" | "REJECTED") {
    const note = (notes[row.orderId] ?? "").trim();
    if (note.length < 2) {
      setError("সিদ্ধান্তের সঙ্গে একটি মন্তব্য লিখুন — যাচাইয়ের রেকর্ড হিসেবে এটি অর্ডারে থাকবে।");
      return;
    }
    setBusyId(row.orderId);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/pharmacy/rx-queue/${row.orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "সিদ্ধান্ত সংরক্ষণ করা যায়নি।");
        return;
      }
      setDoneMessage(
        decision === "APPROVED"
          ? `${row.orderNo}: প্রেসক্রিপশন অনুমোদিত — অর্ডারটি এখন নিশ্চিত করা যাবে।`
          : `${row.orderNo}: প্রেসক্রিপশন বাতিল — অর্ডারটি নিশ্চিত করা যাবে না; প্রয়োজনে অর্ডার বাতিল করুন।`,
      );
      await load();
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
    } finally {
      setBusyId(null);
    }
  }

  if (queue === null && !error) {
    return <p className="mt-6 text-sm text-slate-500">লোড হচ্ছে…</p>;
  }

  return (
    <div className="mt-6">
      {error ? (
        <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      ) : null}
      {doneMessage ? (
        <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {doneMessage}
        </p>
      ) : null}
      {queue && queue.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="text-lg font-bold text-slate-900">কিউ খালি</p>
          <p className="mt-1 text-sm text-slate-500">যাচাইয়ের অপেক্ষায় কোনো প্রেসক্রিপশন অর্ডার নেই।</p>
        </div>
      ) : null}
      <div className="space-y-4">
        {(queue ?? []).map((row) => (
          <article key={row.orderId} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-mono text-base font-bold text-slate-900">{row.orderNo}</h2>
              <span className="text-sm text-slate-500">
                {new Date(row.queuedAt).toLocaleString("bn-BD")} · মোট {formatBdt(row.totalPoisha)}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {row.customerName} · <span className="tabular-nums">{row.customerPhone}</span> · অবস্থা:{" "}
              {row.status}
            </p>
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              {row.rxItems.map((item, i) => (
                <li key={i}>
                  💊 {item.productName} <span className="text-slate-400">({item.sku})</span> × {item.quantity}
                </li>
              ))}
            </ul>
            {row.prescription ? (
              <dl className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                <div>
                  <dt className="inline font-semibold">চিকিৎসক: </dt>
                  <dd className="inline">{row.prescription.prescriberName}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">রেজিস্ট্রেশন নং: </dt>
                  <dd className="inline tabular-nums">{row.prescription.registrationNo}</dd>
                </div>
                {row.prescription.imageUrl ? (
                  <div>
                    <dt className="inline font-semibold">ছবি: </dt>
                    <dd className="inline">
                      <a
                        href={row.prescription.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-indigo-600 hover:underline"
                      >
                        গ্রাহকের দেওয়া লিংক খুলুন
                      </a>
                    </dd>
                  </div>
                ) : null}
                <p className="mt-1 text-xs text-slate-500">
                  গ্রাহক নিশ্চিত করেছেন যে তাঁর কাছে প্রেসক্রিপশনটি আছে — এটি যাচাইকৃত প্রেসক্রিপশন নয়,
                  যাচাইয়ের সিদ্ধান্ত আপনার।
                </p>
              </dl>
            ) : (
              <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                সতর্কতা: এই অর্ডারে প্রেসক্রিপশন রেকর্ড পাওয়া যায়নি — অনুমোদনের আগে গ্রাহকের সঙ্গে
                যোগাযোগ করুন।
              </p>
            )}
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">
                সিদ্ধান্তের মন্তব্য (আবশ্যক)
              </span>
              <input
                value={notes[row.orderId] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [row.orderId]: e.target.value }))}
                placeholder="যেমন: প্রেসক্রিপশন মিলিয়ে দেখা হয়েছে"
                className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-400"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busyId === row.orderId}
                onClick={() => void decide(row, "APPROVED")}
                className="h-11 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                ✓ অনুমোদন করুন
              </button>
              <button
                type="button"
                disabled={busyId === row.orderId}
                onClick={() => void decide(row, "REJECTED")}
                className="h-11 rounded-xl bg-rose-600 px-5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                ✕ বাতিল করুন
              </button>
              <a
                href={`/admin/orders/${row.orderId}`}
                className="inline-flex h-11 items-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                অর্ডার খুলুন
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
