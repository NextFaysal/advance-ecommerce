"use client";

/**
 * Print queue board — self-fetching client (ADV-23 vertical 5,
 * wave 56).
 *
 * Polls GET /api/v1/admin/pod/queue every 30 seconds and says so
 * on the board itself ("polling — live realtime নয়"). Rows are
 * the orders still waiting for the press, oldest first, each with
 * the EXACT frozen print text (the shop prints what the customer
 * typed — the text is shown verbatim, in guillemets, at reading
 * size). Action: ছাপানো হয়েছে — POSTs the attestation, which
 * appends a [pod-printed] note server-side and drops the row on
 * the next load. Customers are shown as first name + masked
 * phone only (the API projects them that way).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@/checkout/pricing";

const POLL_MS = 30_000;

interface QueueRow {
  orderId: string;
  orderNo: string;
  orderStatus: string;
  createdAt: string;
  productName: string;
  printText: string;
  printColor: string | null;
  quantity: number;
  feePoisha: number;
  customerFirstName: string;
  customerPhoneMasked: string;
}

interface QueueData {
  rows: QueueRow[];
  pendingCount: number;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function PrintQueueBoard() {
  const [queue, setQueue] = useState<QueueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/pod/queue", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: QueueData;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? "প্রিন্ট কিউ লোড করা যায়নি।");
        return;
      }
      setQueue(json.data);
      setError(null);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কিউ হালনাগাদ করা যায়নি।");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function markPrinted(row: QueueRow) {
    if (busyId) return;
    setBusyId(row.orderId);
    try {
      const res = await fetch("/api/v1/admin/pod/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: row.orderId }),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "ছাপানো হিসেবে চিহ্নিত করা যায়নি।");
      }
      await load();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — ছাপানো হিসেবে চিহ্নিত করা যায়নি।");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-label="প্রিন্ট কিউ" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
        <span>
          ছাপানো বাকি: <strong className="text-text-main">{queue?.pendingCount ?? 0}টি</strong>
        </span>
        <span>প্রতি ৩০ সেকেন্ডে স্বয়ংক্রিয় হালনাগাদ হয় (polling — live realtime নয়)।</span>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}
      {!queue && !error && <p className="text-sm text-text-muted">প্রিন্ট কিউ লোড হচ্ছে…</p>}
      {queue && queue.rows.length === 0 && (
        <p className="rounded-2xl border border-border bg-surface-2/50 px-4 py-6 text-sm text-text-muted">
          এখন ছাপানোর অপেক্ষায় কোনো অর্ডার নেই।
        </p>
      )}
      <div className="space-y-2.5">
        {(queue?.rows ?? []).map((row) => (
          <article
            key={row.orderId}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card p-3.5 shadow-card"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-text-main">{row.productName}</span>
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-text-muted">
                  × {row.quantity}
                </span>
                {row.printColor && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-text-main">
                    {isHexColor(row.printColor) && (
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 rounded-full border border-border"
                        style={{ backgroundColor: row.printColor }}
                      />
                    )}
                    রঙ: {row.printColor}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-base font-bold leading-relaxed text-text-main">
                «{row.printText}»
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {row.customerFirstName} · {row.customerPhoneMasked} · অর্ডার{" "}
                <Link href={`/admin/orders/${row.orderId}`} className="font-semibold text-brand-700 hover:underline">
                  {row.orderNo}
                </Link>{" "}
                ({row.orderStatus})
                {row.feePoisha > 0 && (
                  <>
                    {" "}· প্রিন্ট ফি: <strong className="text-text-main">{formatBdt(row.feePoisha)}</strong>{" "}
                    (মোটে অন্তর্ভুক্ত)
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busyId === row.orderId}
                onClick={() => void markPrinted(row)}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                ছাপানো হয়েছে
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
