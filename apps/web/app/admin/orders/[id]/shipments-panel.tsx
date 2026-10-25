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
import { formatPoisha } from "@/components/ui/money";

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
  { status: "CREATED", labelBn: "তৈরি", icon: "package" },
  { status: "PICKED_UP", labelBn: "পিকআপ", icon: "box" },
  { status: "IN_TRANSIT", labelBn: "পথে", icon: "truck" },
  { status: "OUT_FOR_DELIVERY", labelBn: "ডেলিভারিতে", icon: "arrow-right" },
  { status: "DELIVERED", labelBn: "ডেলিভার্ড", icon: "check" },
] as const satisfies readonly { status: string; labelBn: string; icon: IconName }[];

const OFF_PATH: Record<string, { labelBn: string; icon: IconName; cls: string }> = {
  FAILED: { labelBn: "ডেলিভারি ব্যর্থ হয়েছে", icon: "alert", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  RETURNING: { labelBn: "পার্সেলটি ফেরত আসছে", icon: "rotate-ccw", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  RETURNED: { labelBn: "পার্সেলটি ফেরত এসেছে", icon: "rotate-ccw", cls: "border-border bg-slate-50 text-slate-600" },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function ParcelStepper({ status }: { status: string }) {
  const activeIdx = PIPELINE_STEPS.findIndex((s) => s.status === status);
  if (activeIdx === -1) {
    const off = OFF_PATH[status];
    if (!off) return null;
    return (
      <p className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-small font-medium ${off.cls}`}>
        <Icon name={off.icon} size={16} />
        {off.labelBn}
      </p>
    );
  }
  return (
    <ol className="mt-3 flex items-start" aria-label={`পার্সেলের অবস্থা: ${PIPELINE_STEPS[activeIdx].labelBn}`}>
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
                {step.labelBn}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ShipmentsPanel({ orderId }: { orderId: string }) {
  const [data, setData] = useState<CoverageData | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create-split form state: checked lines + their quantities.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<string>("steadfast");

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
        <h2 className="text-h3">শিপমেন্ট</h2>
        <p className="mt-1 text-small text-text-muted">শিপমেন্ট দেখার অনুমতি নেই (shipments.view আবশ্যক)।</p>
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

  async function createSplit() {
    const items = openLines
      .filter((l) => selected[l.orderItemId])
      .map((l) => ({
        orderItemId: l.orderItemId,
        quantity: Math.max(1, Math.min(l.remainingQuantity, Number(quantities[l.orderItemId] ?? l.remainingQuantity) || 0)),
      }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) {
      setError("অন্তত একটি লাইন সিলেক্ট করুন।");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/shipments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, provider }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: Booking;
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? `বুকিং তৈরি হয়নি (HTTP ${res.status})`);
        return;
      }
      setMessage(`বিভক্ত বুকিং তৈরি হয়েছে — ট্র্যাকিং: ${json.data.trackingId ?? json.data.id}`);
      setSelected({});
      await load();
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
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
        setError(json.error?.message ?? `ডেলিভার্ড চিহ্নিত হয়নি (HTTP ${res.status})`);
        return;
      }
      setMessage(
        json.data?.fullyDelivered
          ? "সব পার্সেল ডেলিভার্ড — অর্ডার DELIVERED হয়েছে।"
          : "পার্সেলটি ডেলিভার্ড — বাকি লাইন বাকি থাকায় অর্ডার SHIPPED-ই থাকল (আংশিক ডেলিভারি)।",
      );
      await load();
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-h3">শিপমেন্ট (বিভক্ত বুকিংসহ)</h2>
        <p className="mt-0.5 text-small text-text-muted">
          কভারেজ: মোট {totalLines} লাইন — বরাদ্দ {allocatedLines}, ডেলিভার্ড{" "}
          {deliveredLines}। এগুলো স্যান্ডবক্স বুকিং (SBX ট্র্যাকিং); আসল কুরিয়ারে কোনো বুকিং যায় না।
        </p>
        {totalLines > 0 && (
          <div className="mt-3">
            <div
              className="relative h-2.5 overflow-hidden rounded-full bg-slate-100"
              role="img"
              aria-label={`লাইন কভারেজ: বরাদ্দ ${allocatedPct}%, ডেলিভার্ড ${deliveredPct}%`}
            >
              <span className="absolute inset-y-0 left-0 bg-sky-300" style={{ width: `${allocatedPct}%` }} />
              <span className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${deliveredPct}%` }} />
            </div>
            <p className="mt-1.5 flex flex-wrap gap-x-4 text-caption text-text-muted">
              <span>
                <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
                ডেলিভার্ড {deliveredLines}/{totalLines} লাইন
              </span>
              <span>
                <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-300" />
                বরাদ্দ {allocatedLines}/{totalLines} লাইন
              </span>
            </p>
          </div>
        )}
        {partialDelivery && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-small text-amber-800">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span>
              আংশিক ডেলিভারি: {deliveredLines}টি লাইন পৌঁছেছে, বাকিগুলো এখনো পথে/বাকি। সব লাইন ডেলিভার্ড
              না হলে অর্ডার SHIPPED-ই থাকে — একটি পার্সেল পৌঁছানো মানেই অর্ডার ডেলিভার্ড নয়।
            </span>
          </p>
        )}
      </div>

      {data.bookings.length === 0 ? (
        <p className="text-small text-text-muted">এখনো কোনো বুকিং নেই।</p>
      ) : (
        <ul className="space-y-3">
          {data.bookings.map((b) => (
            <li key={b.id} className="rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 font-mono text-small font-semibold">
                  <Icon name="truck" size={15} className="text-text-muted" />
                  {b.trackingId ?? b.id}
                </span>
                <Badge tone="neutral">{b.provider}</Badge>
                <Badge tone={STATUS_TONE[b.status] ?? "neutral"}>{b.status}</Badge>
                {b.items === null ? <Badge tone="info">পুরো অর্ডার</Badge> : <Badge tone="warning">বিভক্ত</Badge>}
                {b.status === "DELIVERED" && (
                  <Badge tone="success">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="check" size={12} /> ডেলিভার্ড
                    </span>
                  </Badge>
                )}
                <span className="ml-auto font-mono text-small tabular-nums">
                  COD {formatPoisha(b.codAmountPoisha)} · চার্জ {formatPoisha(b.chargePoisha)}
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
                <p className="mt-2 text-caption text-text-muted">এই বুকিংয়ে অর্ডারের সব লাইন আছে।</p>
              )}
              <p className="mt-2 text-caption text-text-muted">বুকিং: {formatDate(b.createdAt)}</p>
              {b.items !== null && b.status !== "DELIVERED" && (
                <div className="mt-2">
                  <Button variant="outline" disabled={busy} onClick={() => void markDelivered(b.id)}>
                    এই পার্সেল ডেলিভার্ড চিহ্নিত করুন
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {openLines.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-small font-semibold">নতুন বিভক্ত বুকিং</h3>
          <p className="mt-0.5 text-caption text-text-muted">
            যেসব লাইন এখনো কোনো বুকিংয়ে যায়নি, সেগুলো থেকে বেছে আলাদা পার্সেল বানান।
          </p>
          <div className="mt-3 space-y-2">
            {openLines.map((l) => (
              <label key={l.orderItemId} className="flex flex-wrap items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded accent-[#4F46E5]"
                  checked={!!selected[l.orderItemId]}
                  onChange={(e) => setSelected((s) => ({ ...s, [l.orderItemId]: e.target.checked }))}
                />
                <span className="min-w-0 flex-1">
                  {l.productName} <span className="text-text-muted">({l.sku}) — বাকি {l.remainingQuantity}টি</span>
                </span>
                <input
                  aria-label={`${l.productName} পরিমাণ`}
                  className="h-9 w-20 rounded-md border border-border bg-card px-2 text-sm shadow-sm outline-none focus:border-brand-500"
                  type="number"
                  min={1}
                  max={l.remainingQuantity}
                  value={quantities[l.orderItemId] ?? String(l.remainingQuantity)}
                  onChange={(e) => setQuantities((q) => ({ ...q, [l.orderItemId]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              aria-label="কুরিয়ার প্রোভাইডার"
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
              বিভক্ত বুকিং তৈরি করুন
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-small text-emerald-700">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">
          {error}
        </p>
      )}
    </Card>
  );
}
