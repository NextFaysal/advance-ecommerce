"use client";

/**
 * Shipments panel — order detail page (doc 17, O5).
 *
 * Lists the order's bookings (whole-order bookings from the courier
 * flow + split bookings created here) with their line allocations,
 * shows per-line coverage, and creates ONE split booking for the
 * still-unallocated lines (provider + per-line quantities). A split
 * booking can be marked delivered from here (staff-confirmed); the
 * order itself is only delivered once every line is covered — the
 * partial-delivery rule lives server-side.
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
          কভারেজ: মোট {data.coverage.totalLines} লাইন — বরাদ্দ {data.coverage.allocatedLines}, ডেলিভার্ড{" "}
          {data.coverage.deliveredLines}। এগুলো স্যান্ডবক্স বুকিং (SBX ট্র্যাকিং); আসল কুরিয়ারে কোনো বুকিং যায় না।
        </p>
      </div>

      {data.bookings.length === 0 ? (
        <p className="text-small text-text-muted">এখনো কোনো বুকিং নেই।</p>
      ) : (
        <ul className="space-y-3">
          {data.bookings.map((b) => (
            <li key={b.id} className="rounded-md border border-border px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-small font-semibold">{b.trackingId ?? b.id}</span>
                <Badge tone="neutral">{b.provider}</Badge>
                <Badge tone={STATUS_TONE[b.status] ?? "neutral"}>{b.status}</Badge>
                {b.items === null ? <Badge tone="info">পুরো অর্ডার</Badge> : <Badge tone="warning">বিভক্ত</Badge>}
                <span className="ml-auto font-mono text-small tabular-nums">
                  COD {formatPoisha(b.codAmountPoisha)} · চার্জ {formatPoisha(b.chargePoisha)}
                  {b.weightGrams ? ` · ${b.weightGrams}g` : ""}
                </span>
              </div>
              {b.items !== null && (
                <p className="mt-1.5 text-caption text-text-muted">
                  {b.items.map((i) => `${i.productName ?? i.orderItemId} (${i.sku ?? "—"}) × ${i.quantity}`).join(" · ")}
                </p>
              )}
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
