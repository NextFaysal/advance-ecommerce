"use client";

/**
 * Shipments panel — order detail page (doc 17, O5; design OD5, doc 19).
 *
 * Lists the order's bookings (whole-order bookings from the courier
 * flow + split bookings created here) as PARCEL CARDS: each card
 * carries a status stepper over the booking's CURRENT status (the
 * coverage payload carries status only — no event history — so the
 * stepper marks the parcel's stage in the standard pipeline, never
 * fabricated timestamps), provider + tracking + charge line, its line
 * allocations, and its delivered state. Split shipments additionally
 * get a coverage bar (allocated / delivered lines vs the order's
 * total lines) and an explicit partial-delivery banner: one parcel
 * delivered is NOT the order delivered — the order moves only once
 * every line is covered, and that rule lives server-side.
 *
 * The create-split form below the cards keeps its exact fields and
 * calls (provider + per-line quantities, real booked weights shown
 * from the payload).
 *
 * ADV-5 (doc 22): the form also offers the assignment engine's ranked
 * recommendation for the selected lines (POST …/shipments/
 * recommendation — real shipment-history stats, computed server-side;
 * this component only renders the serializable result). Staff confirm
 * the top pick or override it — an override requires a reason, which
 * the booking API records with the recommendation on the order
 * timeline. With no delivery history the API returns no scores at all
 * and the form stays a plain manual choice.
 *
 * HONEST COPY: these are SANDBOX bookings (SBX tracking ids); no real
 * courier is contacted.
 *
 * Props are serializable only (the order id); data is fetched
 * client-side, so a 403 (no shipments.view) degrades to a quiet note
 * instead of breaking the order page.
 */
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { qtyNumber } from "@/lib/quantity";
import { formatPoisha } from "@/components/ui/money";
import { interpolate, pick, type Locale } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";
import { formatOrderDate } from "../list-helpers";

interface BookingItem {
  orderItemId: string;
  quantity: number;
  productName?: string;
  sku?: string;
}

interface Booking {
  id: string;
  provider: string;
  trackingId: string | null;
  status: string;
  codAmountPoisha: number;
  chargePoisha: number;
  weightGrams: number | null;
  createdAt: string;
  items: BookingItem[] | null;
}

interface Line {
  orderItemId: string;
  productName: string;
  sku: string;
  quantity: number;
  allocatedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
}

interface CoverageData {
  bookings: Booking[];
  lines: Line[];
  coverage: { totalLines: number; allocatedLines: number; deliveredLines: number };
}

/* ADV-5 booking recommendation payload (serializable; mirrors
 * src/shipments/assignment-recommendation.ts). ranked is EMPTY when
 * status is "insufficient_data" — no scores exist to show. */
interface RankedView {
  provider: string;
  score: number | null;
  chargePoisha: number | null;
  estimatedDays: number | null;
  deliveryRateBps: number | null;
  hasHistory: boolean;
  reasonsBn: string[];
  exclusionReasonsBn: string[];
}

interface RecommendationData {
  status: "ok" | "insufficient_data" | "no_eligible";
  facts: { district: string; zone: string; weightGrams: number; codAmountPoisha: number };
  weightEstimated: boolean;
  historyShipments: number;
  recommended: RankedView | null;
  ranked: RankedView[];
  excluded: RankedView[];
  noteBn: string;
}

const PROVIDERS = ["steadfast", "pathao", "redx"] as const;

const inputCls =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  CREATED: "neutral",
  PICKED_UP: "info",
  IN_TRANSIT: "info",
  OUT_FOR_DELIVERY: "warning",
  DELIVERED: "success",
  FAILED: "danger",
  RETURNING: "warning",
  RETURNED: "neutral",
};

/* The linear delivery pipeline a parcel moves through. Every status
 * the coverage payload / courier sync can produce is either one of
 * these five or one of the off-path terminals below — the smoke
 * asserts this mapping against the status set in code. */
const PIPELINE_STEPS = [
  { status: "CREATED", label: { bn: "তৈরি", en: "Created" }, icon: "package" },
  { status: "PICKED_UP", label: { bn: "পিকআপ", en: "Picked up" }, icon: "box" },
  { status: "IN_TRANSIT", label: { bn: "পথে", en: "In transit" }, icon: "truck" },
  { status: "OUT_FOR_DELIVERY", label: { bn: "ডেলিভারিতে", en: "Out for delivery" }, icon: "arrow-right" },
  { status: "DELIVERED", label: { bn: "ডেলিভার্ড", en: "Delivered" }, icon: "check" },
] as const satisfies readonly { status: string; label: Record<Locale, string>; icon: IconName }[];

const OFF_PATH: Record<string, { label: Record<Locale, string>; icon: IconName; cls: string }> = {
  FAILED: { label: { bn: "ডেলিভারি ব্যর্থ হয়েছে", en: "Delivery failed" }, icon: "alert", cls: "border-danger/25 bg-danger-soft text-danger" },
  RETURNING: { label: { bn: "পার্সেলটি ফেরত আসছে", en: "The parcel is returning" }, icon: "rotate-ccw", cls: "border-warning-solid/25 bg-warning-soft text-warning-solid" },
  RETURNED: { label: { bn: "পার্সেলটি ফেরত এসেছে", en: "The parcel has been returned" }, icon: "rotate-ccw", cls: "border-border bg-slate-50 text-slate-600" },
};

function ParcelStepper({ status }: { status: string }) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const activeIdx = PIPELINE_STEPS.findIndex((st) => st.status === status);
  if (activeIdx === -1) {
    const off = OFF_PATH[status];
    if (!off) return null;
    return (
      <p className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-small font-medium ${off.cls}`}>
        <Icon name={off.icon} size={16} />
        {pick(locale, off.label)}
      </p>
    );
  }
  return (
    <ol
      className="mt-3 flex items-start"
      aria-label={interpolate(s.shParcelStatusAria, { label: pick(locale, PIPELINE_STEPS[activeIdx].label) })}
    >
      {PIPELINE_STEPS.map((step, idx) => {
        const done = idx < activeIdx || status === "DELIVERED";
        const active = idx === activeIdx && status !== "DELIVERED";
        return (
          <li key={step.status} className={`flex items-start ${idx > 0 ? "flex-1" : ""}`}>
            {idx > 0 && (
              <span aria-hidden="true" className={`mx-1 mt-[13px] h-0.5 flex-1 rounded ${idx <= activeIdx ? "bg-emerald-400" : "bg-border"}`} />
            )}
            <span className="flex w-14 flex-col items-center gap-1 text-center">
              <span
                aria-hidden="true"
                className={`flex h-[27px] w-[27px] items-center justify-center rounded-full ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-brand-600 text-white ring-4 ring-brand-100"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                <Icon name={done ? "check" : step.icon} size={14} />
              </span>
              <span className={`text-caption leading-tight ${done || active ? "font-semibold text-text-main" : "text-text-muted"}`}>
                {pick(locale, step.label)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ShipmentsPanel({ orderId }: { orderId: string }) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [data, setData] = useState<CoverageData | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create-split form state: checked lines + their quantities.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<string>("steadfast");

  // ADV-5 recommendation state: the engine's ranking for the CURRENT
  // line selection (cleared whenever the selection changes, so a stale
  // ranking can never be booked against different lines), plus the
  // override reason staff must give when booking a different courier.
  const [recommendation, setRecommendation] = useState<RecommendationData | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/shipments`);
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { data?: CoverageData };
      if (json.data) setData(json.data);
    } catch {
      /* panel stays quiet on network failure; the page itself works */
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <Card className="p-5">
        <h2 className="text-h3">{s.tabShipments}</h2>
        <p className="mt-1 text-small text-text-muted">{s.shForbiddenNote}</p>
      </Card>
    );
  }
  if (!data) return null;

  const openLines = data.lines.filter((l) => l.remainingQuantity > 0);
  const { totalLines, allocatedLines, deliveredLines } = data.coverage;
  const isSplit = data.bookings.some((b) => b.items !== null);
  const allocatedPct = totalLines > 0 ? Math.round((allocatedLines / totalLines) * 100) : 0;
  const deliveredPct = totalLines > 0 ? Math.round((deliveredLines / totalLines) * 100) : 0;
  const partialDelivery =
    isSplit && deliveredLines > 0 && deliveredLines < totalLines;

  function selectedItems() {
    return openLines
      .filter((l) => selected[l.orderItemId])
      .map((l) => ({
        orderItemId: l.orderItemId,
        // Wave 59: fractional allocations allowed (weighted lines).
        quantity: Math.max(0.001, Math.min(l.remainingQuantity, qtyNumber(Number(quantities[l.orderItemId] ?? l.remainingQuantity) || 0))),
      }))
      .filter((i) => i.quantity > 0);
  }

  function clearRecommendation() {
    setRecommendation(null);
    setOverrideReason("");
  }

  async function fetchRecommendation() {
    const items = selectedItems();
    if (items.length === 0) {
      setError(s.shRecSelectFirst);
      return;
    }
    setRecBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/shipments/recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: RecommendationData;
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? interpolate(s.shRecFail, { status: res.status }));
        return;
      }
      setRecommendation(json.data);
      setOverrideReason("");
      if (json.data.recommended) setProvider(json.data.recommended.provider);
    } catch {
      setError(s.networkRetry);
    } finally {
      setRecBusy(false);
    }
  }

  const isOverride =
    !!recommendation?.recommended && provider !== recommendation.recommended.provider;

  async function createSplit() {
    const items = selectedItems();
    if (items.length === 0) {
      setError(s.shSelectFirst);
      return;
    }
    if (isOverride && !overrideReason.trim()) {
      setError(s.shOverrideReasonRequired);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/shipments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          provider,
          ...(recommendation
            ? {
                assignment: {
                  recommendedProvider: recommendation.recommended?.provider ?? null,
                  ...(isOverride ? { overrideReason: overrideReason.trim() } : {}),
                },
              }
            : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: Booking;
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? interpolate(s.shBookingFail, { status: res.status }));
        return;
      }
      setMessage(interpolate(s.shBookingCreated, { tracking: json.data.trackingId ?? json.data.id }));
      setSelected({});
      clearRecommendation();
      await load();
    } catch {
      setError(s.networkRetry);
    } finally {
      setBusy(false);
    }
  }

  async function markDelivered(bookingId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/v1/admin/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(bookingId)}/deliver`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        data?: { fullyDelivered: boolean };
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(json.error?.message ?? interpolate(s.shDeliverFail, { status: res.status }));
        return;
      }
      setMessage(json.data?.fullyDelivered ? s.shAllDeliveredMsg : s.shPartialDeliveredMsg);
      await load();
    } catch {
      setError(s.networkRetry);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-h3">{s.shTitle}</h2>
        <p className="mt-0.5 text-small text-text-muted">
          {interpolate(s.shCoverage, { total: totalLines, allocated: allocatedLines, delivered: deliveredLines })}
        </p>
        {totalLines > 0 && (
          <div className="mt-3">
            <div
              className="relative h-2.5 overflow-hidden rounded-full bg-slate-100"
              role="img"
              aria-label={interpolate(s.shCoverageAria, { a: allocatedPct, d: deliveredPct })}
            >
              <span className="absolute inset-y-0 left-0 bg-sky-300" style={{ width: `${allocatedPct}%` }} />
              <span className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${deliveredPct}%` }} />
            </div>
            <p className="mt-1.5 flex flex-wrap gap-x-4 text-caption text-text-muted">
              <span>
                <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
                {interpolate(s.shDeliveredLines, { d: deliveredLines, t: totalLines })}
              </span>
              <span>
                <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-300" />
                {interpolate(s.shAllocatedLines, { a: allocatedLines, t: totalLines })}
              </span>
            </p>
          </div>
        )}
        {partialDelivery && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-warning-solid/25 bg-warning-soft px-3 py-2 text-small text-warning-solid">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span>{interpolate(s.shPartial, { n: deliveredLines })}</span>
          </p>
        )}
      </div>

      {data.bookings.length === 0 ? (
        <p className="text-small text-text-muted">{s.shNoBookings}</p>
      ) : (
        <ul className="space-y-3">
          {data.bookings.map((b) => (
            <li key={b.id} className="rounded-xl border border-border/60 bg-card px-4 py-3.5 shadow-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 font-mono text-small font-semibold">
                  <Icon name="truck" size={15} className="text-text-muted" />
                  {b.trackingId ?? b.id}
                </span>
                <Badge tone="neutral">{b.provider}</Badge>
                <Badge tone={STATUS_TONE[b.status] ?? "neutral"}>{b.status}</Badge>
                {b.items === null ? <Badge tone="info">{s.shWholeOrder}</Badge> : <Badge tone="warning">{s.shSplit}</Badge>}
                {b.status === "DELIVERED" && (
                  <Badge tone="success">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="check" size={12} /> {s.shDeliveredWord}
                    </span>
                  </Badge>
                )}
                <span className="ml-auto font-mono text-small tabular-nums">
                  {interpolate(s.shCodCharge, { cod: formatPoisha(b.codAmountPoisha), charge: formatPoisha(b.chargePoisha) })}
                  {b.weightGrams ? ` · ${b.weightGrams}g` : ""}
                </span>
              </div>
              <ParcelStepper status={b.status} />
              {b.items !== null ? (
                <ul className="mt-3 space-y-1 border-t border-border/60 pt-2.5 text-small">
                  {b.items.map((i) => (
                    <li key={i.orderItemId} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        {i.productName ?? i.orderItemId}{" "}
                        <span className="text-text-muted">({i.sku ?? "—"})</span>
                      </span>
                      <span className="tabular-nums text-text-muted">× {i.quantity}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-caption text-text-muted">{s.shAllLinesNote}</p>
              )}
              <p className="mt-2 text-caption text-text-muted">
                {interpolate(s.shBookedAt, { date: formatOrderDate(b.createdAt, locale) })}
              </p>
              {b.items !== null && b.status !== "DELIVERED" && (
                <div className="mt-2">
                  <Button variant="outline" disabled={busy} onClick={() => void markDelivered(b.id)}>
                    {s.shMarkDelivered}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {openLines.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-small font-semibold">{s.shNewSplitTitle}</h3>
          <p className="mt-0.5 text-caption text-text-muted">{s.shNewSplitHint}</p>
          <div className="mt-3 space-y-2">
            {openLines.map((l) => (
              <label key={l.orderItemId} className="flex flex-wrap items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded accent-brand-600"
                  checked={!!selected[l.orderItemId]}
                  onChange={(e) => {
                    setSelected((prev) => ({ ...prev, [l.orderItemId]: e.target.checked }));
                    clearRecommendation();
                  }}
                />
                <span className="min-w-0 flex-1">
                  {l.productName}{" "}
                  <span className="text-text-muted">
                    {interpolate(s.shLineRemaining, { sku: l.sku, n: l.remainingQuantity })}
                  </span>
                </span>
                <input
                  aria-label={interpolate(s.shQtyAria, { name: l.productName })}
                  className="h-9 w-20 rounded-md border border-border bg-card px-2 text-sm shadow-sm outline-none focus:border-brand-500"
                  type="number"
                  min={0.001}
                  step={0.001}
                  max={l.remainingQuantity}
                  value={quantities[l.orderItemId] ?? String(l.remainingQuantity)}
                  onChange={(e) => {
                    setQuantities((q) => ({ ...q, [l.orderItemId]: e.target.value }));
                    clearRecommendation();
                  }}
                />
              </label>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-border/60 bg-surface-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-small font-semibold">{s.shRecTitle}</h4>
              <Button variant="outline" disabled={recBusy || busy} onClick={() => void fetchRecommendation()}>
                {recommendation ? s.shRecalcBtn : s.shRecBtn}
              </Button>
              {recommendation && (
                <span className="text-caption text-text-muted">
                  {recommendation.facts.district}{" "}
                  {interpolate(s.shRecWeight, { w: recommendation.facts.weightGrams })}
                  {recommendation.weightEstimated ? ` ${s.shRecEstimated}` : ""}{" "}
                  {interpolate(s.shRecCodHist, {
                    cod: formatPoisha(recommendation.facts.codAmountPoisha),
                    n: recommendation.historyShipments,
                  })}
                </span>
              )}
            </div>
            {!recommendation && (
              <p className="mt-1.5 text-caption text-text-muted">{s.shRecIntro}</p>
            )}
            {recommendation?.status === "insufficient_data" && (
              <p className="mt-2 flex items-start gap-2 rounded-xl border border-warning-solid/25 bg-warning-soft px-3 py-2 text-small text-warning-solid">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                <span>
                  {recommendation.noteBn} {s.shRecManualSuffix}
                </span>
              </p>
            )}
            {recommendation && recommendation.status !== "insufficient_data" && (
              <>
                <p className="mt-1.5 text-caption text-text-muted">{recommendation.noteBn}</p>
                {recommendation.ranked.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {recommendation.ranked.map((r) => {
                      const isTop = recommendation.recommended?.provider === r.provider;
                      const isPicked = provider === r.provider;
                      return (
                        <li key={r.provider}>
                          <button
                            type="button"
                            aria-pressed={isPicked}
                            onClick={() => setProvider(r.provider)}
                            className={`w-full rounded-md border px-3 py-2 text-left text-small shadow-sm transition ${
                              isPicked
                                ? "border-brand-500 bg-card ring-2 ring-brand-100"
                                : "border-border bg-card hover:border-brand-300"
                            }`}
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{r.provider}</span>
                              {isTop && <Badge tone="success">{s.shRecommendedBadge}</Badge>}
                              {isPicked && (
                                <Badge tone="info">
                                  <span className="inline-flex items-center gap-1">
                                    <Icon name="check" size={12} /> {s.shPickedBadge}
                                  </span>
                                </Badge>
                              )}
                              {r.hasHistory ? (
                                <span className="tabular-nums text-text-muted">
                                  {interpolate(s.shScore, { score: r.score ?? "—" })}
                                </span>
                              ) : (
                                <Badge tone="warning">{s.shNoHistoryBadge}</Badge>
                              )}
                              <span className="ml-auto tabular-nums text-text-muted">
                                {interpolate(s.shEstCharge, {
                                  charge: r.chargePoisha !== null ? formatPoisha(r.chargePoisha) : "—",
                                })}
                                {r.estimatedDays
                                  ? ` ${interpolate(s.shEstDays, { days: r.estimatedDays })}`
                                  : ""}
                                {r.deliveryRateBps !== null
                                  ? ` ${interpolate(s.shDeliveryRate, { rate: (r.deliveryRateBps / 100).toFixed(1) })}`
                                  : ""}
                              </span>
                            </span>
                            {isTop && r.reasonsBn.length > 0 && (
                              <span className="mt-1 block text-caption text-text-muted">
                                {interpolate(s.tlReason, { reason: r.reasonsBn.join(" · ") })}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {recommendation.excluded.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-caption text-text-muted">
                    {recommendation.excluded.map((r) => (
                      <li key={r.provider}>
                        {r.exclusionReasonsBn[0] ??
                          interpolate(s.shExcludedFallback, { provider: r.provider })}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              aria-label={s.shProviderAria}
              className={`${inputCls} w-44`}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button disabled={busy} onClick={() => void createSplit()}>
              {s.shCreateSplitBtn}
            </Button>
          </div>
          {isOverride && (
            <div className="mt-3">
              <label htmlFor="courier-override-reason" className="text-small font-medium">
                {interpolate(s.shOverrideLabel, { provider: recommendation?.recommended?.provider ?? "" })}
              </label>
              <textarea
                id="courier-override-reason"
                className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                rows={2}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder={s.shOverridePlaceholder}
              />
              <p className="mt-1 text-caption text-text-muted">{s.shOverrideNote}</p>
            </div>
          )}
        </div>
      )}

      {message && (
        <p role="status" className="mt-3 rounded-xl bg-success-soft px-3 py-2 text-small text-success-solid">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
