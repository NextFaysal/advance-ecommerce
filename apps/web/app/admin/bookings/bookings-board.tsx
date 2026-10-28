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
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import {
  SERVICE_BOOKING_STATUS_LABELS_BN,
  SERVICE_BOOKING_STATUS_LABELS_EN,
  type ServiceBookingStatus,
} from "@/services/selection";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BOOKINGS_STRINGS } from "./strings";

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
  BOOKED: "bg-info-soft text-info-solid",
  COMPLETED: "bg-success-soft text-success-solid",
  CANCELLED: "bg-danger-soft text-danger",
  NO_SHOW: "bg-warning-soft text-warning-solid",
};

export function BookingsBoard() {
  const { locale } = useLocale();
  const s = pick(locale, BOOKINGS_STRINGS);
  const statusLabels = locale === "bn" ? SERVICE_BOOKING_STATUS_LABELS_BN : SERVICE_BOOKING_STATUS_LABELS_EN;
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
        setError(json?.error?.message ?? s.boardLoadFailed);
        return;
      }
      setBoard(json.data);
      setError(null);
    } catch {
      setError(s.boardLoadNetwork);
    }
  }, [date, s]);

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
        setError(json?.error?.message ?? s.updateFailed);
      }
      await load();
    } catch {
      setError(s.updateNetwork);
    } finally {
      setBusyId(null);
    }
  }

  const total = board ? Object.values(board.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <section aria-label={s.boardAria} className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
        <label className="flex items-center gap-2">
          <span className="font-medium text-text-main">{s.dayLabel}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 md:min-h-0"
          />
        </label>
        <button
          type="button"
          onClick={() => setDate(todayDhakaYmd())}
          className="min-h-11 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 md:min-h-0"
        >
          {s.today}
        </button>
        <span>
          <strong className="tnum text-text-main">{interpolate(s.totalCount, { count: total })}</strong>
        </span>
        <span>
          <strong className="tnum text-text-main">{interpolate(s.bookedCount, { count: board?.counts.BOOKED ?? 0 })}</strong>{" "}
          ·{" "}
          <strong className="tnum text-text-main">{interpolate(s.completedCount, { count: board?.counts.COMPLETED ?? 0 })}</strong>{" "}
          ·{" "}
          <strong className="tnum text-text-main">{interpolate(s.noShowCount, { count: board?.counts.NO_SHOW ?? 0 })}</strong>{" "}
          ·{" "}
          <strong className="tnum text-text-main">{interpolate(s.cancelledCount, { count: board?.counts.CANCELLED ?? 0 })}</strong>
        </span>
        <span>{s.pollNote}</span>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
      {!board && !error && <p className="text-sm text-text-muted">{s.boardLoading}</p>}
      {board && board.groups.length === 0 && (
        <EmptyState title={s.dayEmptyTitle} description={s.dayEmptyDesc} />
      )}
      <div className="space-y-4">
        {(board?.groups ?? []).map((group) => (
          <div key={`${group.slotStart}-${group.slotEnd}`} className="rounded-2xl border border-border bg-surface-2/50 p-3">
            <h3 className="mb-3 flex items-center justify-between px-1 font-display text-sm font-semibold text-text-main">
              <span className="tnum">{group.slotStart} – {group.slotEnd}</span>
              <span className="tnum rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-text-muted">
                {interpolate(s.groupBookings, { count: group.bookings.length })}
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
                        {statusLabels[row.status]}
                      </span>
                      {row.staffLabel && (
                        <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-ink">
                          {row.staffLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {row.customerFirstName} · {row.customerPhoneMasked} · {s.orderWord}{" "}
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
                        className="min-h-11 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50 md:min-h-0"
                      >
                        {s.completeBtn}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void advance(row, "NO_SHOW")}
                        className="min-h-11 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50 md:min-h-0"
                      >
                        {s.noShowBtn}
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
