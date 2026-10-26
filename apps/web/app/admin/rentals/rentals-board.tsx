"use client";

/**
 * Rentals board — self-fetching client (ADV-23 vertical 3,
 * wave 56).
 *
 * Polls GET /api/v1/admin/rentals every 30 seconds and says so on
 * the board itself ("polling — live realtime নয়"). Rows are the
 * live rentals (stored ACTIVE + OVERDUE) ordered by return date;
 * OVERDUE is also computed server-side at read — an ACTIVE rental
 * past its endDate arrives with displayStatus OVERDUE even before
 * anyone marks it (there is no cron). Actions: ফেরত এসেছে
 * (RETURNED — stamps returnedAt) and মেয়াদোত্তীর্ণ চিহ্নিত
 * (OVERDUE, manual mark). A 409 (a stale board racing another
 * screen, or the order was cancelled meanwhile) surfaces as an
 * inline error, never a silent win. The board moves NO money:
 * each row shows the deposit frozen at order time, and staff
 * refund it manually on return — the button label group says so.
 * The configured late fee is shown as the contractual per-day
 * rate only; nothing charges it automatically in v1. Customers
 * are shown as first name + masked phone only (the API projects
 * them that way).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@/checkout/pricing";
import {
  RENTAL_STATUS_LABELS_BN,
  type RentalStatus,
} from "@/rental/selection";

const POLL_MS = 30_000;

interface BoardRow {
  id: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  productName: string;
  startDate: string;
  endDate: string;
  days: number;
  depositPoisha: number;
  status: RentalStatus;
  displayStatus: RentalStatus;
  daysRemaining: number;
  customerFirstName: string;
  customerPhoneMasked: string;
}

interface BoardData {
  today: string;
  rentals: BoardRow[];
  counts: Record<RentalStatus, number>;
  lateFeePerDayPoisha: number;
}

const STATUS_BADGE: Record<RentalStatus, string> = {
  ACTIVE: "bg-sky-100 text-sky-800",
  RETURNED: "bg-emerald-100 text-emerald-800",
  OVERDUE: "bg-rose-100 text-rose-700",
  CANCELLED: "bg-slate-200 text-slate-600",
};

function daysText(row: BoardRow): string {
  if (row.daysRemaining > 0) return `আর ${row.daysRemaining} দিন বাকি`;
  if (row.daysRemaining === 0) return "আজই ফেরতের দিন";
  return `${-row.daysRemaining} দিন মেয়াদোত্তীর্ণ`;
}

export function RentalsBoard() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/rentals", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: BoardData;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? "ভাড়ার বোর্ড লোড করা যায়নি।");
        return;
      }
      setBoard(json.data);
      setError(null);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — বোর্ড হালনাগাদ করা যায়নি।");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function advance(row: BoardRow, to: "RETURNED" | "OVERDUE") {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/v1/admin/rentals/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "ভাড়া হালনাগাদ করা যায়নি।");
      }
      await load();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — ভাড়া হালনাগাদ করা যায়নি।");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-label="ভাড়ার বোর্ড" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
        <span>
          চলমান: <strong className="text-text-main">{board?.counts.ACTIVE ?? 0}টি</strong> ·
          মেয়াদোত্তীর্ণ: <strong className="text-text-main">{board?.counts.OVERDUE ?? 0}টি</strong> ·
          ফেরত: <strong className="text-text-main">{board?.counts.RETURNED ?? 0}টি</strong> · বাতিল:{" "}
          <strong className="text-text-main">{board?.counts.CANCELLED ?? 0}টি</strong>
        </span>
        {board && board.lateFeePerDayPoisha > 0 && (
          <span>
            চুক্তির বিলম্ব ফি: দিনপ্রতি <strong className="text-text-main">{formatBdt(board.lateFeePerDayPoisha)}</strong>{" "}
            (ম্যানুয়ালি হিসাব হয় — নিজে থেকে কাটা হয় না)
          </span>
        )}
        <span>প্রতি ৩০ সেকেন্ডে স্বয়ংক্রিয় হালনাগাদ হয় (polling — live realtime নয়)।</span>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}
      {!board && !error && <p className="text-sm text-text-muted">ভাড়ার বোর্ড লোড হচ্ছে…</p>}
      {board && board.rentals.length === 0 && (
        <p className="rounded-2xl border border-border bg-surface-2/50 px-4 py-6 text-sm text-text-muted">
          এখন কোনো চলমান ভাড়া নেই।
        </p>
      )}
      <div className="space-y-2.5">
        {(board?.rentals ?? []).map((row) => (
          <article
            key={row.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card p-3.5 shadow-card"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-text-main">{row.productName}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[row.displayStatus]}`}
                >
                  {RENTAL_STATUS_LABELS_BN[row.displayStatus]}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    row.daysRemaining < 0
                      ? "bg-rose-100 text-rose-700"
                      : row.daysRemaining === 0
                        ? "bg-amber-100 text-amber-800"
                        : "bg-surface-2 text-text-muted"
                  }`}
                >
                  {daysText(row)}
                </span>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {row.customerFirstName} · {row.customerPhoneMasked} · অর্ডার{" "}
                <Link href={`/admin/orders/${row.orderId}`} className="font-semibold text-brand-700 hover:underline">
                  {row.orderNo}
                </Link>{" "}
                ({row.orderStatus}) · ভাড়া: {row.startDate} → {row.endDate} ({row.days} দিন)
                {row.depositPoisha > 0 && (
                  <>
                    {" "}· জামানত: <strong className="text-text-main">{formatBdt(row.depositPoisha)}</strong>{" "}
                    (ফেরতে ম্যানুয়ালি ফেরত দিন)
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busyId === row.id}
                onClick={() => void advance(row, "RETURNED")}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                ফেরত এসেছে
              </button>
              {row.displayStatus === "ACTIVE" && (
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void advance(row, "OVERDUE")}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-50"
                >
                  মেয়াদোত্তীর্ণ চিহ্নিত করুন
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
