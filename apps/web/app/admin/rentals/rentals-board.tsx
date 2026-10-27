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
  RENTAL_STATUS_LABELS_EN,
  type RentalStatus,
} from "@/rental/selection";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { RENTALS_STRINGS, type RentalsStrings } from "./strings";

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

function daysText(s: RentalsStrings, row: BoardRow): string {
  if (row.daysRemaining > 0) return interpolate(s.daysRemaining, { days: row.daysRemaining });
  if (row.daysRemaining === 0) return s.dueToday;
  return interpolate(s.daysOverdue, { days: -row.daysRemaining });
}

export function RentalsBoard() {
  const { locale } = useLocale();
  const s = pick(locale, RENTALS_STRINGS);
  const statusLabels = locale === "bn" ? RENTAL_STATUS_LABELS_BN : RENTAL_STATUS_LABELS_EN;
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
        setError(json?.error?.message ?? s.boardLoadFailed);
        return;
      }
      setBoard(json.data);
      setError(null);
    } catch {
      setError(s.boardLoadNetwork);
    }
  }, [s]);

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
        setError(json?.error?.message ?? s.updateFailed);
      }
      await load();
    } catch {
      setError(s.updateNetwork);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-label={s.boardAria} className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
        <span>
          {s.activeLabel}{" "}
          <strong className="text-text-main">{interpolate(s.count, { count: board?.counts.ACTIVE ?? 0 })}</strong> ·{" "}
          {s.overdueLabel}{" "}
          <strong className="text-text-main">{interpolate(s.count, { count: board?.counts.OVERDUE ?? 0 })}</strong> ·{" "}
          {s.returnedLabel}{" "}
          <strong className="text-text-main">{interpolate(s.count, { count: board?.counts.RETURNED ?? 0 })}</strong> ·{" "}
          {s.cancelledLabel}{" "}
          <strong className="text-text-main">{interpolate(s.count, { count: board?.counts.CANCELLED ?? 0 })}</strong>
        </span>
        {board && board.lateFeePerDayPoisha > 0 && (
          <span>
            {s.lateFeePrefix}{" "}
            <strong className="text-text-main">{formatBdt(board.lateFeePerDayPoisha)}</strong> {s.lateFeeSuffix}
          </span>
        )}
        <span>{s.pollNote}</span>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}
      {!board && !error && <p className="text-sm text-text-muted">{s.boardLoading}</p>}
      {board && board.rentals.length === 0 && (
        <p className="rounded-2xl border border-border bg-surface-2/50 px-4 py-6 text-sm text-text-muted">
          {s.emptyBoard}
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
                  {statusLabels[row.displayStatus]}
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
                  {daysText(s, row)}
                </span>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {row.customerFirstName} · {row.customerPhoneMasked} · {s.orderWord}{" "}
                <Link href={`/admin/orders/${row.orderId}`} className="font-semibold text-brand-700 hover:underline">
                  {row.orderNo}
                </Link>{" "}
                ({row.orderStatus}) ·{" "}
                {interpolate(s.rentalPeriod, { start: row.startDate, end: row.endDate, days: row.days })}
                {row.depositPoisha > 0 && (
                  <>
                    {" "}· {s.depositPrefix}{" "}
                    <strong className="text-text-main">{formatBdt(row.depositPoisha)}</strong> {s.depositSuffix}
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
                {s.returnedBtn}
              </button>
              {row.displayStatus === "ACTIVE" && (
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void advance(row, "OVERDUE")}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-50"
                >
                  {s.markOverdueBtn}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
