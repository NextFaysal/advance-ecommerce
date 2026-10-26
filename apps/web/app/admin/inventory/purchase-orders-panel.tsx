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
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PoListRow {
  id: string;
  supplierName: string;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  totalPoisha: number;
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
  costPoisha: number;
}

interface HistoryEntry {
  id: string;
  variantId: string;
  quantityDelta: number;
  quantityAfter: number;
  createdAt: string;
}

interface PoDetail {
  id: string;
  supplierName: string;
  status: PoListRow["status"];
  effectiveWarehouseId: string | null;
  warehouseIsDefault: boolean;
  receivedValuePoisha: number;
  totalPoisha: number;
  lines: DetailLine[];
  history: HistoryEntry[];
}

const STATUS_LABEL: Record<PoListRow["status"], string> = {
  draft: "খসড়া",
  ordered: "অর্ডার করা",
  partially_received: "আংশিক গৃহীত",
  received: "সম্পূর্ণ গৃহীত",
  cancelled: "বাতিল",
};

const STATUS_TONE: Record<PoListRow["status"], "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  ordered: "info",
  partially_received: "warning",
  received: "success",
  cancelled: "danger",
};

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `recv-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export default function PurchaseOrdersPanel() {
  const [orders, setOrders] = useState<PoListRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(newKey());

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/inventory/purchase-orders");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? "তালিকা লোড করা যায়নি");
      setOrders(json.data.purchaseOrders as PoListRow[]);
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "তালিকা লোড করা যায়নি");
    }
  }, []);

  const loadDetail = useCallback(async (poId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/purchase-orders/${poId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? "বিস্তারিত লোড করা যায়নি");
      setDetail(json.data.purchaseOrder as PoDetail);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "বিস্তারিত লোড করা যায়নি");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

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
    setFormError(null);
    setFormNotice(null);
    idempotencyKey.current = newKey();
    void loadDetail(poId);
  }

  async function submitReceive() {
    if (!detail || submitting) return;
    const lines = detail.lines
      .map((l) => ({ itemId: l.itemId, quantity: Number(quantities[l.itemId] ?? "") }))
      .filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);
    if (lines.length === 0) {
      setFormError("অন্তত একটি লাইনে গৃহীত পরিমাণ লিখুন।");
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
            ? `অতিরিক্ত রিসিভ — এই লাইনে বাকি আছে মাত্র ${d.remaining}টি। পুরো রিসিভটাই বাতিল হয়েছে, কিছুই জমা হয়নি।`
            : (json?.error?.message ?? "রিসিভ করা যায়নি।"),
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
          ? "এই রিসিভটি আগেই জমা হয়েছিল — নতুন করে কিছু যোগ হয়নি।"
          : `রিসিভ জমা হয়েছে — এই চালানে ${formatBdt(r.receivedValueDeltaPoisha)} মূল্যের পণ্য স্টকে যোগ হয়েছে। অবস্থা: ${STATUS_LABEL[r.status]}।` +
              (r.erpPosting
                ? r.erpPosting.status === "posted"
                  ? " ERP জার্নালে ক্রয়-প্রাপ্তি পোস্ট হয়েছে।"
                  : ` ERP পোস্টিং হয়নি (${r.erpPosting.status}${r.erpPosting.reason ? `: ${r.erpPosting.reason}` : ""}) — স্টক ঠিকই জমা হয়েছে।`
                : ""),
      );
      idempotencyKey.current = newKey();
      setQuantities({});
      await loadDetail(detail.id);
      await loadOrders();
    } catch {
      setFormError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন। একই বোতামে আবার চাপ দিলে একই রিসিভ দুবার জমা হবে না (idempotency key সক্রিয়)।");
    } finally {
      setSubmitting(false);
    }
  }

  if (listError) {
    return <p className="text-small text-rose-600">ক্রয় আদেশ লোড করা যায়নি: {listError}</p>;
  }
  if (orders === null) {
    return <p className="text-small text-text-muted">ক্রয় আদেশ লোড হচ্ছে…</p>;
  }
  if (orders.length === 0) {
    return (
      <p className="text-small leading-relaxed text-text-muted">
        কোনো ক্রয় আদেশ নেই। API দিয়ে তৈরি করা যায়: POST /api/v1/admin/inventory/purchase-orders
        (সাপ্লায়ার + গুদাম + ভ্যারিয়েন্ট লাইন)। তৈরি হলেই এখানে রিসিভ করা যাবে।
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
                  {new Date(po.createdAt).toLocaleString("bn-BD")} · মোট {formatBdt(po.totalPoisha)} ·{" "}
                  <span className="font-mono">{po.id}</span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[po.status]} dot>
                  {STATUS_LABEL[po.status]}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => toggle(po.id)}>
                  {open ? "বন্ধ করুন" : "রিসিভ / বিস্তারিত"}
                </Button>
              </span>
            </div>

            {open ? (
              <div className="mt-3 border-t border-border pt-3">
                {detailLoading || !detail ? (
                  <p className="text-small text-text-muted">লোড হচ্ছে…</p>
                ) : (
                  <>
                    <p className="text-caption leading-relaxed text-text-muted">
                      গুদাম:{" "}
                      <span className="font-mono">{detail.effectiveWarehouseId ?? "—"}</span>
                      {detail.warehouseIsDefault ? " (ডিফল্ট গুদাম — এই অর্ডারে গুদাম নির্দিষ্ট করা নেই)" : ""}
                      {" · "}এখন পর্যন্ত গৃহীত মূল্য: {formatBdt(detail.receivedValuePoisha)}
                    </p>

                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                        <thead>
                          <tr className="text-left [&>th]:border-b [&>th]:border-border">
                            {["পণ্য", "অর্ডার", "গৃহীত", "বাকি", "এবার গ্রহণ"].map((h) => (
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
                                  {l.sku ? `SKU: ${l.sku} · ` : ""}কস্ট {formatBdt(l.costPoisha)}
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
                                    placeholder={`সর্বোচ্চ ${l.remaining}`}
                                    aria-label={`${l.productTitleBn ?? l.variantId} — এবার গ্রহণের পরিমাণ`}
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

                    {formError ? (
                      <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">{formError}</p>
                    ) : null}
                    {formNotice ? (
                      <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-small text-emerald-700">{formNotice}</p>
                    ) : null}

                    {detail.status !== "cancelled" && detail.lines.some((l) => l.remaining > 0) ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Button onClick={() => void submitReceive()} loading={submitting}>
                          রিসিভ জমা দিন
                        </Button>
                        <span className="text-caption text-text-subtle">
                          জমা দিলেই স্টক লেজারে PURCHASE_RECEIVE মুভমেন্ট যুক্ত হবে — সংখ্যা শুধু এখানে যা লিখবেন তাই।
                        </span>
                      </div>
                    ) : null}

                    <div className="mt-4">
                      <p className="text-small font-semibold text-text-main">রিসিভ ইতিহাস</p>
                      {detail.history.length === 0 ? (
                        <p className="mt-1 text-caption text-text-muted">এখনো কোনো রিসিভ হয়নি।</p>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {detail.history.map((h) => (
                            <li key={h.id} className="text-caption text-text-muted">
                              {new Date(h.createdAt).toLocaleString("bn-BD")} ·{" "}
                              <span className="font-mono">{h.variantId}</span> · +{h.quantityDelta} (রিসিভের পর
                              হাতে {h.quantityAfter})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
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
