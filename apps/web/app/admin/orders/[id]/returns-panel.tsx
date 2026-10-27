"use client";

/**
 * Returns (RMA) panel — order detail page (doc 17, O7).
 *
 * Lists this order's returns (from GET /api/v1/admin/orders/[id]/
 * returns) and creates new ones (POST, source "admin"). The create
 * form only appears for DELIVERED orders — the server enforces the
 * same rule. Quantities in the form are capped by the API's per-line
 * returnable state (ordered − already returned, open returns flagged).
 *
 * The lifecycle itself (approve / receive + restock / complete /
 * reject / close) runs in the returns queue at /admin/returns; this
 * panel links there. HONEST COPY: completing a return records a
 * PENDING refund in the refund workbench — no money moves here.
 *
 * Props are serializable only (the order id); data is fetched
 * client-side, so a 403 (no returns.view) degrades to a quiet note
 * instead of breaking the order page.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPoisha } from "@/components/ui/money";
import { interpolate, pick, type Locale } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";
import { formatOrderDateTime } from "../list-helpers";

interface PanelLine {
  orderItemId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  orderedQuantity: number;
  returnedQuantity: number;
  openReturn: boolean;
  returnableQuantity: number;
}

interface PanelReturnItem {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  condition: "restockable" | "damaged" | null;
  lineValuePoisha: number;
}

interface PanelReturn {
  id: string;
  status: string;
  source: string;
  reason: string;
  refundId: string | null;
  goodsValuePoisha: number;
  items: PanelReturnItem[];
  createdAt: string;
}

const STATUS_LABEL: Record<string, Record<Locale, string>> = {
  REQUESTED: { bn: "অনুরোধ এসেছে", en: "Requested" },
  APPROVED: { bn: "অনুমোদিত — পণ্য আসছে", en: "Approved — goods incoming" },
  REJECTED: { bn: "বাতিল", en: "Rejected" },
  RECEIVED: { bn: "পণ্য পৌঁছেছে", en: "Goods received" },
  COMPLETED: { bn: "সম্পন্ন (রিফান্ড PENDING)", en: "Completed (refund PENDING)" },
  CLOSED: { bn: "বন্ধ (রিফান্ড নেই)", en: "Closed (no refund)" },
};

const STATUS_TONE_MAP: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  REQUESTED: "warning",
  APPROVED: "info",
  REJECTED: "danger",
  RECEIVED: "info",
  COMPLETED: "success",
  CLOSED: "neutral",
};

const inputCls =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const qtyCls =
  "h-10 w-20 rounded-md border border-border bg-card px-2 text-sm shadow-sm outline-none transition focus:border-brand-500";

export function ReturnsPanel({ orderId }: { orderId: string }) {
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [returns, setReturns] = useState<PanelReturn[] | null>(null);
  const [lines, setLines] = useState<PanelLine[]>([]);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/returns`);
      if (res.status === 403) {
        setForbidden(true);
        setReturns([]);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setReturns(json.data?.returns ?? []);
      setLines(json.data?.lines ?? []);
      setOrderStatus(json.data?.orderStatus ?? null);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : s.rtLoadFailFallback);
      setReturns([]);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const items = lines
      .filter((l) => (qty[l.orderItemId] ?? 0) > 0)
      .map((l) => ({
        orderItemId: l.orderItemId,
        quantity: qty[l.orderItemId] ?? 0,
        reason: reasons[l.orderItemId]?.trim() ? reasons[l.orderItemId].trim() : undefined,
      }));
    if (items.length === 0) {
      setActionError(s.rtCreateQtyErr);
      return;
    }
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, note: note.trim() ? note.trim() : undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setNotice(s.rtCreated);
      setQty({});
      setReasons({});
      setNote("");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : s.rtCreateFailFallback);
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return (
      <Card className="p-4">
        <h3 className="text-small font-semibold text-text-main">{s.rtTitle}</h3>
        <p className="mt-1 text-small text-text-muted">{s.rtForbidden}</p>
      </Card>
    );
  }

  const canCreate =
    orderStatus === "DELIVERED" && lines.some((l) => l.returnableQuantity > 0 && !l.openReturn);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-small font-semibold text-text-main">{s.rtTitle}</h3>
        <Link href="/admin/returns" className="text-small font-medium text-brand-700 hover:underline">
          {s.rtQueueLink}
        </Link>
      </div>

      {loadError && (
        <p role="alert" className="mt-3 rounded-md bg-danger-50 px-3 py-2 text-small text-danger-700">
          {loadError}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-md bg-success-50 px-3 py-2 text-small text-success-700">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-3 rounded-md bg-danger-50 px-3 py-2 text-small text-danger-700">
          {actionError}
        </p>
      )}

      {returns === null ? (
        <p className="mt-3 text-small text-text-muted">{t.loading}</p>
      ) : returns.length === 0 ? (
        <p className="mt-3 text-small text-text-muted">{s.rtNone}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {returns.map((r) => {
            const uiLabel = STATUS_LABEL[r.status]
              ? pick(locale, STATUS_LABEL[r.status])
              : r.status;
            const uiTone = STATUS_TONE_MAP[r.status] ?? "neutral";
            return (
              <li key={r.id} className="rounded-md border border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <Badge tone={uiTone}>{uiLabel}</Badge>
                  <span className="text-small text-text-muted">
                    {r.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")} ·{" "}
                    {formatPoisha(r.goodsValuePoisha)}
                  </span>
                  <span className="text-caption text-text-subtle">{formatOrderDateTime(r.createdAt, locale)}</span>
                </div>
                <p className="mt-1 text-small text-text-muted">
                  {interpolate(s.tlReason, { reason: r.reason })}
                  {r.items.some((i) => i.condition) ? (
                    <>
                      {" "}·{" "}
                      {interpolate(s.rtCondition, {
                        list: r.items
                          .map(
                            (i) =>
                              `${i.productName}: ${i.condition === "restockable" ? s.rtCondGood : i.condition === "damaged" ? s.rtCondDamaged : "—"}`,
                          )
                          .join(", "),
                      })}
                    </>
                  ) : null}
                  {r.refundId ? <> {s.rtRefundRecorded}</> : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {orderStatus === "DELIVERED" ? (
        canCreate ? (
          <div className="mt-4 border-t border-border pt-3.5">
            <h4 className="text-small font-semibold text-text-main">{s.rtNewTitle}</h4>
            <div className="mt-2.5 space-y-2">
              {lines.map((l) => (
                <div key={l.orderItemId} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-40 flex-1 text-small">
                    {l.productName}
                    <span className="block text-caption text-text-subtle">
                      {l.sku} · {interpolate(s.rtOrdered, { n: l.orderedQuantity })}
                      {l.returnedQuantity > 0
                        ? ` ${interpolate(s.rtReturnedPart, { n: l.returnedQuantity })}`
                        : ""}
                      {l.openReturn ? ` ${s.rtOpenPart}` : ""}
                    </span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={l.returnableQuantity}
                    className={qtyCls}
                    value={qty[l.orderItemId] ?? 0}
                    disabled={l.openReturn || l.returnableQuantity === 0}
                    onChange={(e) =>
                      setQty((prev) => ({ ...prev, [l.orderItemId]: Number(e.target.value) }))
                    }
                    aria-label={interpolate(s.rtQtyAria, { name: l.productName })}
                  />
                  <input
                    className={`${inputCls} min-w-44 flex-1`}
                    placeholder={s.rtReasonOptPlaceholder}
                    value={reasons[l.orderItemId] ?? ""}
                    disabled={l.openReturn || l.returnableQuantity === 0}
                    onChange={(e) =>
                      setReasons((prev) => ({ ...prev, [l.orderItemId]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            <input
              className={`${inputCls} mt-2.5`}
              placeholder={s.rtNoteOptPlaceholder}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button className="mt-3" disabled={busy} onClick={() => void create()}>
              {s.rtCreateBtn}
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-small text-text-muted">{s.rtAllReturned}</p>
        )
      ) : (
        <p className="mt-3 text-small text-text-muted">{s.rtOnlyDelivered}</p>
      )}
    </Card>
  );
}
