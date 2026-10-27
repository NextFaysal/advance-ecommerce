"use client";

/**
 * Purchase orders + goods receiving panel (ADV-11b) — mounted on the
 * admin inventory page. Lists POs from the existing endpoint
 * (GET /api/v1/admin/inventory/purchase-orders); expanding one loads
 * the receive detail (GET /api/v1/admin/purchase-orders/[id]) with
 * per-line ordered / received / remaining and the receive history
 * (the PURCHASE_RECEIVE movements booked against the PO).
 *
 * Receiving posts to POST /api/v1/admin/purchase-orders/[id]/receive.
 * Quantity inputs start EMPTY on purpose — a received quantity is
 * only ever what staff actually type and submit here, never a
 * pre-filled guess. One idempotency key is generated per receive
 * intent (regenerated after each successful receive) and the submit
 * button disables while a request is in flight, so a double click
 * or a network retry cannot book the same delivery twice; the
 * server re-checks the key inside its transaction as well.
 *
 * Language (doc 30, slice L5-D): every string comes from ./strings
 * (INVENTORY_STRINGS) resolved via useLocale(); dates use
 * intlLocale(locale).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick } from "@/i18n/locale";
import { INVENTORY_STRINGS, type InventoryStrings } from "./strings";

interface PoListRow {
  id: string;
  supplierName: string;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  // ADV-27: null when cost-masked for this viewer (no
  // products.edit_cost_price) — render "—", never a number.
  totalPoisha: number | null;
  createdAt: string;
}

interface DetailLine {
  itemId: string;
  variantId: string;
  sku: string | null;
  productTitleBn: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  remaining: number;
  costPoisha: number | null;
}

interface HistoryEntry {
  id: string;
  variantId: string;
  quantityDelta: number;
  quantityAfter: number;
  createdAt: string;
}

interface DetailBatch {
  batchId: string;
  batchCode: string;
  sku: string | null;
  expiryDate: string | null;
  quantityOnHand: number;
  bin: string | null;
  serialCount: number;
}

interface PoDetail {
  id: string;
  supplierName: string;
  status: PoListRow["status"];
  effectiveWarehouseId: string | null;
  warehouseIsDefault: boolean;
  receivedValuePoisha: number | null;
  totalPoisha: number | null;
  lines: DetailLine[];
  history: HistoryEntry[];
  batches: DetailBatch[];
}

/** ADV-20 optional per-line depth capture, held as raw form text. */
interface DepthDraft {
  batchCode: string;
  expiryDate: string;
  bin: string;
  serials: string;
}

const EMPTY_DEPTH: DepthDraft = { batchCode: "", expiryDate: "", bin: "", serials: "" };

const STATUS_TONE: Record<PoListRow["status"], "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  ordered: "info",
  partially_received: "warning",
  received: "success",
  cancelled: "danger",
};

function statusLabel(s: InventoryStrings, status: PoListRow["status"]): string {
  switch (status) {
    case "draft": return s.poStatusDraft;
    case "ordered": return s.poStatusOrdered;
    case "partially_received": return s.poStatusPartial;
    case "received": return s.poStatusReceived;
    case "cancelled": return s.poStatusCancelled;
  }
}

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `recv-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export default function PurchaseOrdersPanel() {
  const { locale, t: ct } = useLocale();
  const s = pick(locale, INVENTORY_STRINGS);
  const [orders, setOrders] = useState<PoListRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // ADV-27: true when the API masked cost fields for this viewer.
  const [costMasked, setCostMasked] = useState(false);
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [depthDrafts, setDepthDrafts] = useState<Record<string, DepthDraft>>({});
  const [depthOpen, setDepthOpen] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(newKey());

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/inventory/purchase-orders");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? s.listLoadFailed);
      setOrders(json.data.purchaseOrders as PoListRow[]);
      setCostMasked(json?.meta?.costMasked === true);
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : s.listLoadFailed);
    }
  }, [s.listLoadFailed]);

  const loadDetail = useCallback(async (poId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/purchase-orders/${poId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? s.detailLoadFailed);
      setDetail(json.data.purchaseOrder as PoDetail);
      setCostMasked(json?.meta?.costMasked === true);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : s.detailLoadFailed);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [s.detailLoadFailed]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  function toggle(poId: string) {
    if (openId === poId) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(poId);
    setDetail(null);
    setQuantities({});
    setDepthDrafts({});
    setDepthOpen({});
    setFormError(null);
    setFormNotice(null);
    idempotencyKey.current = newKey();
    void loadDetail(poId);
  }

  async function submitReceive() {
    if (!detail || submitting) return;
    const lines = detail.lines
      .map((l) => {
        const quantity = Number(quantities[l.itemId] ?? "");
        const base = { itemId: l.itemId, quantity };
        if (!depthOpen[l.itemId]) return base;
        const draft = depthDrafts[l.itemId] ?? EMPTY_DEPTH;
        const serials = draft.serials
          .split(/[\n,]+/)
          .map((x) => x.trim())
          .filter((x) => x.length > 0);
        return {
          ...base,
          ...(draft.batchCode.trim() ? { batchCode: draft.batchCode.trim() } : {}),
          ...(draft.expiryDate ? { expiryDate: draft.expiryDate } : {}),
          ...(draft.bin.trim() ? { bin: draft.bin.trim() } : {}),
          ...(serials.length > 0 ? { serials } : {}),
        };
      })
      .filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);
    if (lines.length === 0) {
      setFormError(s.errAtLeastOne);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setFormNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/purchase-orders/${detail.id}/receive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines, idempotencyKey: idempotencyKey.current }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = json?.error?.code as string | undefined;
        const d = json?.error?.details as { remaining?: number } | undefined;
        setFormError(
          code === "over_receive" && d?.remaining !== undefined
            ? interpolate(s.errOverReceive, { remaining: d.remaining })
            : code === "serial_count_mismatch"
              ? s.errSerialMismatch
              : code === "duplicate_serial"
                ? s.errDuplicateSerial
                : code === "inventory_depth_disabled"
                  ? s.errDepthDisabled
                  : (json?.error?.message ?? s.errReceiveFailed),
        );
        return;
      }
      const r = json.data.receive as {
        status: PoListRow["status"];
        receivedValueDeltaPoisha: number;
        idempotentReplay: boolean;
        erpPosting: { status: string; reason?: string } | null;
      };
      setFormNotice(
        r.idempotentReplay
          ? s.noticeReplay
          : interpolate(s.noticeReceived, {
              amount: formatBdt(r.receivedValueDeltaPoisha),
              status: statusLabel(s, r.status),
            }) +
              (r.erpPosting
                ? r.erpPosting.status === "posted"
                  ? s.erpPosted
                  : interpolate(s.erpNotPosted, {
                      status: r.erpPosting.status,
                      reason: r.erpPosting.reason
                        ? interpolate(s.erpReasonPrefix, { reason: r.erpPosting.reason })
                        : "",
                    })
                : ""),
      );
      idempotencyKey.current = newKey();
      setQuantities({});
      setDepthDrafts({});
      setDepthOpen({});
      await loadDetail(detail.id);
      await loadOrders();
    } catch {
      setFormError(s.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  if (listError) {
    return <p className="text-small text-rose-600">{interpolate(s.poListLoadFailed, { error: listError })}</p>;
  }
  if (orders === null) {
    return <p className="text-small text-text-muted">{s.poListLoading}</p>;
  }
  if (orders.length === 0) {
    return (
      <p className="text-small leading-relaxed text-text-muted">
        {s.poEmpty}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((po) => {
        const open = openId === po.id;
        return (
          <div key={po.id} className="rounded-lg border border-border bg-surface-2/50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <span className="min-w-0">
                <span className="block truncate text-small font-semibold text-text-main">{po.supplierName}</span>
                <span className="mt-0.5 block text-caption text-text-subtle">
                  {new Date(po.createdAt).toLocaleString(intlLocale(locale))} · {s.totalText}{" "}
                  {po.totalPoisha !== null ? formatBdt(po.totalPoisha) : "—"} ·{" "}
                  <span className="font-mono">{po.id}</span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[po.status]} dot>
                  {statusLabel(s, po.status)}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => toggle(po.id)}>
                  {open ? ct.close : s.receiveDetail}
                </Button>
              </span>
            </div>

            {open ? (
              <div className="mt-3 border-t border-border pt-3">
                {detailLoading || !detail ? (
                  <p className="text-small text-text-muted">{ct.loading}</p>
                ) : (
                  <>
                    <p className="text-caption leading-relaxed text-text-muted">
                      {s.warehouseText}{" "}
                      <span className="font-mono">{detail.effectiveWarehouseId ?? "—"}</span>
                      {detail.warehouseIsDefault ? ` ${s.defaultWarehouseNote}` : ""}
                      {" · "}{s.receivedValueText}{" "}
                      {detail.receivedValuePoisha !== null ? formatBdt(detail.receivedValuePoisha) : "—"}
                      {costMasked && ` ${s.costMaskedNote}`}
                    </p>

                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                        <thead>
                          <tr className="text-left [&>th]:border-b [&>th]:border-border">
                            {[s.colProduct, s.colOrdered, s.colReceived, s.colRemaining, s.colReceiveNow].map((h) => (
                              <th key={h} scope="col" className="px-2 py-2 text-caption font-semibold text-text-muted">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detail.lines.map((l) => (
                            <tr key={l.itemId} className="border-t border-border first:border-t-0">
                              <td className="px-2 py-2">
                                <span className="block text-small font-medium text-text-main">
                                  {l.productTitleBn ?? l.variantId}
                                </span>
                                <span className="block text-caption text-text-subtle">
                                  {l.sku ? `SKU: ${l.sku} · ` : ""}{s.costText}{" "}
                                  {l.costPoisha !== null ? formatBdt(l.costPoisha) : "—"}
                                </span>
                              </td>
                              <td className="px-2 py-2 font-mono tabular-nums">{l.quantityOrdered}</td>
                              <td className="px-2 py-2 font-mono tabular-nums">{l.quantityReceived}</td>
                              <td className="px-2 py-2 font-mono tabular-nums">{l.remaining}</td>
                              <td className="px-2 py-2">
                                {detail.status !== "cancelled" && l.remaining > 0 ? (
                                  <Input
                                    type="number"
                                    min={1}
                                    max={l.remaining}
                                    step={1}
                                    inputMode="numeric"
                                    placeholder={interpolate(s.maxPlaceholder, { max: l.remaining })}
                                    aria-label={interpolate(s.receiveQtyAria, { name: l.productTitleBn ?? l.variantId })}
                                    className="w-28"
                                    value={quantities[l.itemId] ?? ""}
                                    disabled={submitting}
                                    onChange={(e) =>
                                      setQuantities((q) => ({ ...q, [l.itemId]: e.target.value }))
                                    }
                                  />
                                ) : (
                                  <span className="text-text-subtle">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* ADV-20: optional batch / serial capture per
                        line. Collapsed by default — a plain receive
                        is byte-identical to before. The server
                        rejects depth fields while the
                        module.inventory_depth flag is OFF. */}
                    {detail.status !== "cancelled" && detail.lines.some((l) => l.remaining > 0) ? (
                      <div className="mt-3 space-y-2">
                        {detail.lines
                          .filter((l) => l.remaining > 0)
                          .map((l) => {
                            const draft = depthDrafts[l.itemId] ?? EMPTY_DEPTH;
                            const openDepth = depthOpen[l.itemId] === true;
                            const setDraft = (patch: Partial<DepthDraft>) =>
                              setDepthDrafts((d) => ({ ...d, [l.itemId]: { ...(d[l.itemId] ?? EMPTY_DEPTH), ...patch } }));
                            return (
                              <div key={l.itemId} className="rounded-md border border-border bg-card px-3 py-2">
                                <label className="flex cursor-pointer items-center gap-2 text-small font-medium text-text-main">
                                  <input
                                    type="checkbox"
                                    checked={openDepth}
                                    disabled={submitting}
                                    onChange={(e) =>
                                      setDepthOpen((o) => ({ ...o, [l.itemId]: e.target.checked }))
                                    }
                                  />
                                  {interpolate(s.depthToggle, { name: l.productTitleBn ?? l.variantId })}
                                  {l.sku ? <span className="font-mono text-caption text-text-subtle">{l.sku}</span> : null}
                                </label>
                                {openDepth ? (
                                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <Input
                                      placeholder={s.batchPlaceholder}
                                      aria-label={s.batchAria}
                                      value={draft.batchCode}
                                      disabled={submitting}
                                      onChange={(e) => setDraft({ batchCode: e.target.value })}
                                    />
                                    <Input
                                      type="date"
                                      aria-label={s.expiryAria}
                                      value={draft.expiryDate}
                                      disabled={submitting}
                                      onChange={(e) => setDraft({ expiryDate: e.target.value })}
                                    />
                                    <Input
                                      placeholder={s.binPlaceholder}
                                      aria-label={s.binAria}
                                      value={draft.bin}
                                      disabled={submitting}
                                      onChange={(e) => setDraft({ bin: e.target.value })}
                                    />
                                    <textarea
                                      className="min-h-16 rounded-md border border-border bg-card px-3 py-2 text-small"
                                      placeholder={s.serialsPlaceholder}
                                      aria-label={s.serialsAria}
                                      value={draft.serials}
                                      disabled={submitting}
                                      onChange={(e) => setDraft({ serials: e.target.value })}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                      </div>
                    ) : null}

                    {formError ? (
                      <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">{formError}</p>
                    ) : null}
                    {formNotice ? (
                      <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-small text-emerald-700">{formNotice}</p>
                    ) : null}

                    {detail.status !== "cancelled" && detail.lines.some((l) => l.remaining > 0) ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Button onClick={() => void submitReceive()} loading={submitting}>
                          {s.submitReceive}
                        </Button>
                        <span className="text-caption text-text-subtle">
                          {s.submitNote}
                        </span>
                      </div>
                    ) : null}

                    <div className="mt-4">
                      <p className="text-small font-semibold text-text-main">{s.historyTitle}</p>
                      {detail.history.length === 0 ? (
                        <p className="mt-1 text-caption text-text-muted">{s.historyNone}</p>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {detail.history.map((h) => (
                            <li key={h.id} className="text-caption text-text-muted">
                              {interpolate(s.historyLine, {
                                date: new Date(h.createdAt).toLocaleString(intlLocale(locale)),
                                variantId: h.variantId,
                                delta: h.quantityDelta,
                                after: h.quantityAfter,
                              })}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {detail.batches.length > 0 ? (
                      <div className="mt-4">
                        <p className="text-small font-semibold text-text-main">{s.batchesTitle}</p>
                        <ul className="mt-1 space-y-1">
                          {detail.batches.map((b) => (
                            <li key={b.batchId} className="text-caption text-text-muted">
                              <span className="font-mono font-semibold text-text-main">{b.batchCode}</span>
                              {b.sku ? ` · ${interpolate(s.batchSkuText, { sku: b.sku })}` : ""} · {interpolate(s.onHandText, { count: b.quantityOnHand })}
                              {b.expiryDate
                                ? ` · ${interpolate(s.batchExpiryText, { date: new Date(b.expiryDate).toLocaleDateString(intlLocale(locale)) })}`
                                : ` · ${s.batchNoExpiry}`}
                              {b.bin ? ` · ${interpolate(s.batchBinText, { bin: b.bin })}` : ""}
                              {b.serialCount > 0 ? ` · ${interpolate(s.batchSerialText, { count: b.serialCount })}` : ""}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 text-caption text-text-subtle">
                          {s.batchesNote}
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
