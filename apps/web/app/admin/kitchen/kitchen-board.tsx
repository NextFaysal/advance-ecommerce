"use client";

/**
 * KDS board — self-fetching client (ADV-23, wave 56).
 *
 * Polls GET /api/v1/admin/kitchen/tickets every 15 seconds and says
 * so on the board itself ("polling — live realtime নয়"): the
 * kitchen sees a near-current queue, and nobody is told it is a
 * live feed. Columns are the three live states; SERVED/CANCELLED
 * appear only as today's counts. Advancing a ticket PATCHes the
 * one allowed next step and refetches — a 409 (a stale board racing
 * another screen) surfaces as an inline error, never a silent win.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  KITCHEN_NEXT_STATUS,
  KITCHEN_STATUS_LABELS_BN,
  KITCHEN_STATUS_LABELS_EN,
  type KitchenTicketStatus,
} from "@/restaurant/selection";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { KITCHEN_STRINGS } from "./strings";

const POLL_MS = 15_000;

interface BoardTicket {
  id: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  fulfilmentType: "DINE_IN" | "TAKEAWAY";
  tableLabel: string | null;
  status: KitchenTicketStatus;
  createdAt: string;
  readyAt: string | null;
  items: Array<{ productName: string; sku: string; quantity: string; quantityNumber: number }>;
}

interface BoardData {
  tickets: BoardTicket[];
  servedTodayCount: number;
  cancelledTodayCount: number;
}

function elapsedMinutes(iso: string, nowMs: number): number {
  const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  return mins < 0 ? 0 : mins;
}

export function KitchenBoard() {
  const { locale } = useLocale();
  const s = pick(locale, KITCHEN_STRINGS);
  const statusLabels = locale === "bn" ? KITCHEN_STATUS_LABELS_BN : KITCHEN_STATUS_LABELS_EN;
  const columns: Array<{ status: KitchenTicketStatus; advanceLabel: string }> = [
    { status: "QUEUED", advanceLabel: s.advanceStart },
    { status: "PREPARING", advanceLabel: s.advanceReady },
    { status: "READY", advanceLabel: s.advanceServed },
  ];
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/kitchen/tickets", { cache: "no-store" });
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
      setNowMs(Date.now());
    } catch {
      setError(s.boardLoadNetwork);
    }
  }, [s]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function advance(ticket: BoardTicket) {
    const next = KITCHEN_NEXT_STATUS[ticket.status];
    if (!next || busyId) return;
    setBusyId(ticket.id);
    try {
      const res = await fetch(`/api/v1/admin/kitchen/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? s.advanceFailed);
      }
      await load();
    } catch {
      setError(s.advanceNetwork);
    } finally {
      setBusyId(null);
    }
  }

  if (!board && !error) {
    return <p className="text-sm text-text-muted">{s.boardLoading}</p>;
  }

  return (
    <section aria-label={s.boardAria} className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
        <span>
          {s.servedTodayLabel}{" "}
          <strong className="text-text-main">{interpolate(s.count, { count: board?.servedTodayCount ?? 0 })}</strong>
        </span>
        <span>
          {s.cancelledTodayLabel}{" "}
          <strong className="text-text-main">{interpolate(s.count, { count: board?.cancelledTodayCount ?? 0 })}</strong>
        </span>
        <span>{s.pollNote}</span>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {columns.map((col) => {
          const tickets = (board?.tickets ?? []).filter((t) => t.status === col.status);
          return (
            <div key={col.status} className="rounded-2xl border border-border bg-surface-2/50 p-3">
              <h3 className="mb-3 flex items-center justify-between px-1 text-sm font-bold text-text-main">
                {statusLabels[col.status]}
                <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-text-muted">
                  {tickets.length}
                </span>
              </h3>
              <div className="space-y-3">
                {tickets.length === 0 && (
                  <p className="px-1 py-2 text-sm text-text-subtle">{s.noTickets}</p>
                )}
                {tickets.map((ticket) => {
                  const mins = elapsedMinutes(ticket.createdAt, nowMs);
                  return (
                    <article key={ticket.id} className="rounded-xl border border-border bg-card p-3.5 shadow-card">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={`/admin/orders/${ticket.orderId}`}
                          className="font-display text-sm font-bold text-brand-700 hover:underline"
                        >
                          {ticket.orderNo}
                        </Link>
                        {ticket.fulfilmentType === "DINE_IN" ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                            {interpolate(s.tableLabel, { label: ticket.tableLabel ?? "—" })}
                          </span>
                        ) : (
                          <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-800">
                            {s.takeaway}
                          </span>
                        )}
                      </div>
                      <ul className="mt-2.5 space-y-1 text-sm text-text-main">
                        {ticket.items.map((item, i) => (
                          <li key={i} className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0">
                              {item.productName}
                              <span className="ml-1.5 text-xs text-text-subtle">{item.sku}</span>
                            </span>
                            <span className="shrink-0 font-semibold tabular-nums">× {item.quantity}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span
                          className={`text-xs font-medium ${
                            mins >= 20 ? "text-rose-600" : "text-text-muted"
                          }`}
                        >
                          {interpolate(s.waiting, { mins })}
                        </span>
                        <button
                          type="button"
                          disabled={busyId === ticket.id}
                          onClick={() => void advance(ticket)}
                          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                        >
                          {col.advanceLabel}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
