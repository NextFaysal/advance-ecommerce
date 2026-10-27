"use client";

/* ------------------------------------------------------------------ */
/* Customer 360 panel (C1) — self-contained: fetches its own context  */
/* for the claimed task (parent remounts it per task via `key`), so a  */
/* failed load can never lose the claimed task in the workbench.      */
/* One-click order actions reuse the EXISTING orders API              */
/* (PATCH /api/v1/admin/orders/[id]) — no parallel transition path.   */
/* Moved verbatim from the monolith in CD1; the only rendering swap   */
/* is a past call's disposition now rendering as the CD0              */
/* DispositionChip instead of a raw code in parentheses.              */
/* ------------------------------------------------------------------ */

import { lineTotalPoisha } from "@/lib/quantity";
import { useCallback, useEffect, useState } from "react";
import { DispositionChip } from "@/callcenter/components";
import { isCallDisposition } from "@/callcenter/dispositions";
import { formatBdt } from "@/checkout/pricing";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { CALL_CENTER_STRINGS } from "../strings";
import {
  AUTO_OUTCOME_LABEL,
  SOURCE_LABEL,
  bnDateTime,
  readJson,
  type ContextResponse,
  type OrderActionResponse,
  type TaskContext,
} from "./shared";

export function Customer360Panel({
  taskId,
  onOrderMutated,
}: {
  taskId: string;
  onOrderMutated: () => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  const [ctx, setCtx] = useState<TaskContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [reason, setReason] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderMsg, setOrderMsg] = useState<string | null>(null);
  const [orderErr, setOrderErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(`/api/v1/admin/call-center/tasks/${taskId}/context`);
        const body = await readJson<ContextResponse>(res);
        if (cancelled) return;
        if (!res.ok || !body.data) {
          setLoadError(body.error?.message ?? interpolate(s.ctxLoadFailedMsg, { status: res.status }));
          setCtx(null);
          return;
        }
        setCtx(body.data);
      } catch {
        if (!cancelled) {
          setLoadError(s.ctxNetworkError);
          setCtx(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, reloadKey, locale]);

  const orderAction = useCallback(
    async (to: "CONFIRMED" | "CANCELLED") => {
      if (!ctx?.order) return;
      if (to === "CANCELLED" && !cancelArmed) {
        // First click only arms the reason input — the orders API
        // requires a reason for CANCELLED and rejects without one.
        setCancelArmed(true);
        setOrderErr(null);
        return;
      }
      if (to === "CANCELLED" && !reason.trim()) {
        setOrderErr(s.cancelReasonRequired);
        return;
      }
      setOrderBusy(true);
      setOrderErr(null);
      setOrderMsg(null);
      try {
        const res = await fetch(`/api/v1/admin/orders/${ctx.order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(to === "CANCELLED" ? { to, reason: reason.trim() } : { to }),
        });
        const body = await readJson<OrderActionResponse>(res);
        if (!res.ok || body.error) {
          // The orders API's own verdict, verbatim (its guards decide —
          // a 403 for a missing permission lands here unchanged).
          setOrderErr(body.error?.message ?? interpolate(s.orderUpdateFailed, { status: res.status }));
          return;
        }
        setOrderMsg(
          interpolate(to === "CONFIRMED" ? s.orderConfirmedMsg : s.orderCancelledMsg, {
            orderNo: body.data?.orderNo ?? "",
          }),
        );
        setCancelArmed(false);
        setReason("");
        setReloadKey((k) => k + 1);
        onOrderMutated();
      } catch {
        setOrderErr(s.orderNetworkError);
      } finally {
        setOrderBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, cancelArmed, reason, onOrderMutated, locale],
  );

  const order = ctx?.order ?? null;
  const canCancel =
    order !== null &&
    (order.status === "PENDING" ||
      order.status === "CONFIRMED" ||
      order.status === "PROCESSING" ||
      order.status === "PACKED");

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-base font-semibold">{s.customer360Title}</h3>

      {loading ? (
        <p className="mt-2 text-sm text-text-muted">{s.ctxLoading}</p>
      ) : loadError ? (
        <div className="mt-2">
          <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {interpolate(s.ctxBannerFailed, { error: loadError })}
          </p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-2 rounded-md bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            {s.tryAgain}
          </button>
        </div>
      ) : ctx ? (
        <>
          {order ? (
            <>
              <dl className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-text-muted">{s.fieldOrder}</dt>
                  <dd className="font-medium">
                    {order.orderNo} · <span>{order.status}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">{s.fieldPayment}</dt>
                  <dd>
                    {order.paymentMethod} · {order.paymentStatus}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">{s.fieldPhoneOnOrder}</dt>
                  <dd className="font-medium">{order.customerPhone}</dd>
                </div>
                <div>
                  <dt className="text-text-muted">{s.fieldRiskScore}</dt>
                  <dd>
                    {order.riskScore} ({order.riskBand})
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-text-muted">{s.fieldAddress}</dt>
                  <dd>
                    {order.address.addressLine}
                    {order.address.union ? `, ${order.address.union}` : ""}, {order.address.upazila},{" "}
                    {order.address.district}, {order.address.division}
                  </dd>
                </div>
              </dl>

              <h4 className="mt-3 text-sm font-semibold">{s.itemsTitle}</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {order.items.map((i, idx) => (
                  <li key={idx} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {i.productName} <span className="text-text-muted">({i.sku})</span> × {i.quantity}
                    </span>
                    <span>{formatBdt(lineTotalPoisha(i.unitPricePoisha, i.quantity))}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-2 space-y-0.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">{s.subtotal}</dt>
                  <dd>{formatBdt(order.subtotalPoisha)}</dd>
                </div>
                {order.discountPoisha > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{s.discount}</dt>
                    <dd>−{formatBdt(order.discountPoisha)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="text-text-muted">{s.delivery}</dt>
                  <dd>{formatBdt(order.shippingPoisha)}</dd>
                </div>
                {order.codFeePoisha > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{s.codFee}</dt>
                    <dd>{formatBdt(order.codFeePoisha)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-border pt-1 font-semibold">
                  <dt>{s.total}</dt>
                  <dd>{formatBdt(order.totalPoisha)}</dd>
                </div>
              </dl>

              {/* One-click order actions (existing orders API) */}
              <div className="mt-3 rounded-md bg-surface-2 p-3">
                <h4 className="text-sm font-semibold">{s.orderActionsTitle}</h4>
                {orderMsg ? (
                  <p role="status" className="mt-2 rounded-md bg-emerald-50 px-2.5 py-1.5 text-sm text-emerald-800">
                    {orderMsg}
                  </p>
                ) : null}
                {orderErr ? (
                  <p role="alert" className="mt-2 rounded-md bg-rose-50 px-2.5 py-1.5 text-sm text-rose-700">
                    {orderErr}
                  </p>
                ) : null}
                {cancelArmed ? (
                  <label className="mt-2 block text-sm">
                    <span className="text-text-muted">{s.cancelReasonLabel}</span>
                    <input
                      type="text"
                      value={reason}
                      maxLength={500}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-1 w-full rounded-md border border-rose-300 px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                      placeholder={s.cancelReasonPlaceholder}
                    />
                  </label>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {order.status === "PENDING" ? (
                    <button
                      type="button"
                      disabled={orderBusy}
                      onClick={() => void orderAction("CONFIRMED")}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      {s.confirmOrderBtn}
                    </button>
                  ) : null}
                  {canCancel ? (
                    <button
                      type="button"
                      disabled={orderBusy}
                      onClick={() => void orderAction("CANCELLED")}
                      className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      {cancelArmed ? s.cancelConfirmBtn : s.cancelOrderBtn}
                    </button>
                  ) : null}
                  {order.status !== "PENDING" && !canCancel ? (
                    <p className="text-xs text-text-muted">
                      {interpolate(s.cannotActInState, { status: order.status })}
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-text-muted">
              {s.manualTaskNoOrder}
              {ctx.task.note ? (
                <>
                  {" "}
                  {s.taskNoteInline} <span className="font-medium">{ctx.task.note}</span>
                </>
              ) : null}
            </p>
          )}

          {ctx.recentOrders.length > 0 ? (
            <>
              <h4 className="mt-4 text-sm font-semibold">
                {interpolate(s.recentOrdersTitle, { count: ctx.recentOrders.length })}
              </h4>
              <div className="overflow-x-auto">
                <table className="mt-1 w-full text-left text-sm">
                  <thead>
                    <tr className="text-text-muted">
                      <th className="py-1 pr-2 font-medium">{s.fieldOrder}</th>
                      <th className="py-1 pr-2 font-medium">{s.colDate}</th>
                      <th className="py-1 pr-2 font-medium">{s.total}</th>
                      <th className="py-1 font-medium">{s.colStatus}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ctx.recentOrders.map((o) => (
                      <tr key={o.id} className="border-t border-border">
                        <td className="py-1 pr-2">
                          {o.orderNo}
                          {order && o.id === order.id ? (
                            <span className="ml-1 text-xs text-indigo-600">{s.thisOrderTag}</span>
                          ) : null}
                        </td>
                        <td className="py-1 pr-2">{bnDateTime(o.createdAt, locale)}</td>
                        <td className="py-1 pr-2">{formatBdt(o.totalPoisha)}</td>
                        <td className="py-1">{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <h4 className="mt-4 text-sm font-semibold">{s.pastCallsTitle}</h4>
          {ctx.pastCalls.filter((c) => !String(c.outcome).startsWith("AUTO_")).length > 0 ? (
            <ul className="mt-1 space-y-2 text-sm">
              {ctx.pastCalls
                .filter((c) => !String(c.outcome).startsWith("AUTO_"))
                .map((c) => (
                  <li key={c.id} className="rounded-md bg-surface-2 px-3 py-2">
                    <span className="font-medium">{bnDateTime(c.calledAt, locale)}</span> ·{" "}
                    {SOURCE_LABEL[c.source][locale]} · {s.outcomeInline} {c.outcome}
                    {c.disposition ? (
                      <>
                        {" "}
                        {isCallDisposition(c.disposition) ? (
                          <DispositionChip disposition={c.disposition} lang={locale} />
                        ) : (
                          <span className="font-mono">{c.disposition}</span>
                        )}
                      </>
                    ) : null}{" "}
                    · {s.agentInline}{" "}
                    {c.agentName ?? c.agentId}
                    {c.note ? (
                      <span className="block text-text-muted">{s.noteInline} {c.note}</span>
                    ) : null}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-text-muted">{s.noPastCalls}</p>
          )}

          {/* C4 automation timeline — this task's AUTO_* log rows:
              what was scheduled, what was sent, what was skipped and
              why (the log note carries the detail verbatim). */}
          {ctx.pastCalls.some(
            (c) => c.taskId === taskId && String(c.outcome).startsWith("AUTO_"),
          ) ? (
            <>
              <h4 className="mt-4 text-sm font-semibold">{s.automationTimelineTitle}</h4>
              <ul className="mt-1 space-y-2 text-sm">
                {ctx.pastCalls
                  .filter((c) => c.taskId === taskId && String(c.outcome).startsWith("AUTO_"))
                  .map((c) => (
                    <li key={c.id} className="rounded-md bg-sky-50 px-3 py-2">
                      <span className="font-medium">{bnDateTime(c.calledAt, locale)}</span> ·{" "}
                      {AUTO_OUTCOME_LABEL[c.outcome]?.[locale] ?? c.outcome}
                      {c.note ? (
                        <span className="block text-text-muted">{c.note}</span>
                      ) : null}
                    </li>
                  ))}
              </ul>
              <p className="mt-1 text-xs text-text-muted">
                {s.automationNote}
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
