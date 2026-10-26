"use client";

/**
 * Bookings board — self-fetching client (ADV-23, wave 56).
 *
 * Polls GET /api/v1/admin/bookings?date= every 30 seconds and says
 * so on the board itself ("polling — live realtime নয়"). The day
 * picker defaults to today (Asia/Dhaka). Rows are grouped by slot
 * (the server groups them); a BOOKED row can advance to COMPLETED
 * or NO_SHOW — a 409 (a stale board racing another screen, or the
 * order was cancelled meanwhile) surfaces as an inline error,
 * never a silent win. Customers are shown as first name + masked
 * phone only (the API projects them that way).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  SERVICE_BOOKING_STATUS_LABELS_BN,
  type ServiceBookingStatus,
} from "@/services/selection";

const POLL_MS = 30_000;

interface BoardRow {
  id: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  productName: string;
  slotStart: string;
  slotEnd: string;
  staffLabel: string | null;
  status: ServiceBookingStatus;
  customerFirstName: string;
  customerPhoneMasked: string;
}

interface BoardData {
  date: string;
  groups: Array<{ slotStart: string; slotEnd: string; bookings: BoardRow[] }>;
  counts: Record<ServiceBookingStatus, number>;
}

function todayDhakaYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const STATUS_BADGE: Record<ServiceBookingStatus, string> = {
  BOOKED: "bg-sky-100 text-sky-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-rose-100 text-rose-700",
  NO_SHOW: "bg-amber-100 text-amber-800",
};

export function BookingsBoard() {
  const [date, setDate] = useState(() => todayDhakaYmd());
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/bookings?date=${encodeURIComponent(date)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as {
        data?: BoardData;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? "বুকিং বোর্ড লোড করা যায়নি।");
        return;
      }
      setBoard(json.data);
      setError(null);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — বোর্ড হালনাগাদ করা যায়নি।");
    }
  }, [date]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function advance(row: BoardRow, to: "COMPLETED" | "NO_SHOW") {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/v1/admin/bookings/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "বুকিং হালনাগাদ করা যায়নি।");
      }
      await load();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — বুকিং হালনাগাদ করা যায়নি।");
    } finally {
      setBusyId(null);
    }
  }

  const total = board ? Object.values(board.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <section aria-label="বুকিং বোর্ড" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
        <label className="flex items-center gap-2">
          <span className="font-medium text-text-main">দিন</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-text-main"
          />
        </label>
        <button
          type="button"
          onClick={() => setDate(todayDhakaYmd())}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main transition hover:bg-surface-2"
        >
          আজ
        </button>
        <span>
          মোট: <strong className="text-text-main">{total}টি</strong>
        </span>
        <span>
          বুক করা: <strong className="text-text-main">{board?.counts.BOOKED ?? 0}টি</strong> · সম্পন্ন:{" "}
          <strong className="text-text-main">{board?.counts.COMPLETED ?? 0}টি</strong> · আসেননি:{" "}
          <strong className="text-text-main">{board?.counts.NO_SHOW ?? 0}টি</strong> · বাতিল:{" "}
          <strong className="text-text-main">{board?.counts.CANCELLED ?? 0}টি</strong>
        </span>
        <span>প্রতি ৩০ সেকেন্ডে স্বয়ংক্রিয় হালনাগাদ হয় (polling — live realtime নয়)।</span>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}
      {!board && !error && <p className="text-sm text-text-muted">বুকিং বোর্ড লোড হচ্ছে…</p>}
      {board && board.groups.length === 0 && (
        <p className="rounded-2xl border border-border bg-surface-2/50 px-4 py-6 text-sm text-text-muted">
          এই দিনে কোনো বুকিং নেই।
        </p>
      )}
      <div className="space-y-4">
        {(board?.groups ?? []).map((group) => (
          <div key={`${group.slotStart}-${group.slotEnd}`} className="rounded-2xl border border-border bg-surface-2/50 p-3">
            <h3 className="mb-3 flex items-center justify-between px-1 text-sm font-bold text-text-main">
              {group.slotStart} – {group.slotEnd}
              <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-text-muted">
                {group.bookings.length}টি বুকিং
              </span>
            </h3>
            <div className="space-y-2.5">
              {group.bookings.map((row) => (
                <article
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card p-3.5 shadow-card"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-text-main">{row.productName}</span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[row.status]}`}
                      >
                        {SERVICE_BOOKING_STATUS_LABELS_BN[row.status]}
                      </span>
                      {row.staffLabel && (
                        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-800">
                          {row.staffLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {row.customerFirstName} · {row.customerPhoneMasked} · অর্ডার{" "}
                      <Link href={`/admin/orders/${row.orderId}`} className="font-semibold text-brand-700 hover:underline">
                        {row.orderNo}
                      </Link>{" "}
                      ({row.orderStatus})
                    </p>
                  </div>
                  {row.status === "BOOKED" && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void advance(row, "COMPLETED")}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                      >
                        সম্পন্ন
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void advance(row, "NO_SHOW")}
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-50"
                      >
                        আসেননি
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
