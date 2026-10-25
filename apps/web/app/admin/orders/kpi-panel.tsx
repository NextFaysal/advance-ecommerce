"use client";

/**
 * Order KPI strip (doc 17, batch O8-2) — mounted on the admin orders
 * page under the aging panel. Fetches GET /api/v1/admin/orders/kpis
 * for a selectable range (today / last 7 days / last 30 days, Asia/
 * Dhaka calendar days) and renders each rate WITH its numerator and
 * denominator — "৩৭/৫২" next to the percentage — because a rate
 * without its counts is a claim nobody can check. A rate whose
 * denominator is 0 renders as "—" (the API returns ratePercent null
 * rather than a fabricated 0%). Definitions live in src/orders/kpis.
 */
import { useEffect, useState } from "react";
import { formatBdt } from "../../../src/checkout/pricing";
import { dhakaYmdOf, shiftYmd, todayDhakaYmd } from "../../../src/lib/dhaka-date";

interface KpiRate {
  numerator: number;
  denominator: number;
  ratePercent: number | null;
}

interface OrderKpis {
  range: { from: string; to: string };
  ordersCreated: number;
  ordersDelivered: number;
  confirmationRate: KpiRate;
  deliverySuccessRate: KpiRate;
  averageOrderValue: { totalPoisha: number; orders: number; averagePoisha: number | null };
  returnRate: KpiRate;
  advanceCollectionRate: KpiRate;
  codCollectionRate: KpiRate & { collectedPoisha: number; duePoisha: number };
  cancelRate: KpiRate;
}

type RangeKey = "today" | "7d" | "30d";

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; days: number }> = [
  { key: "today", label: "আজ", days: 0 },
  { key: "7d", label: "শেষ ৭ দিন", days: 6 },
  { key: "30d", label: "শেষ ৩০ দিন", days: 29 },
];

function rangeFor(key: RangeKey): { from: string; to: string } {
  const to = todayDhakaYmd();
  const days = RANGE_OPTIONS.find((o) => o.key === key)?.days ?? 29;
  return { from: shiftYmd(to, -days), to };
}

function KpiCard({
  label,
  headline,
  detail,
}: {
  label: string;
  headline: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-card">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-tight">{headline}</p>
      <p className="mt-0.5 text-xs text-text-muted">{detail}</p>
    </div>
  );
}

function rateHeadline(rate: KpiRate): string {
  return rate.ratePercent === null ? "—" : `${rate.ratePercent}%`;
}

export function KpiPanel() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const [kpis, setKpis] = useState<OrderKpis | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const { from, to } = rangeFor(rangeKey);
        const res = await fetch(`/api/v1/admin/orders/kpis?from=${from}&to=${to}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data: OrderKpis };
        if (!cancelled) setKpis(json.data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeKey]);

  return (
    <section aria-label="অর্ডার KPI" className="mb-4 rounded-lg border border-border bg-surface-2 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          অর্ডার KPI{" "}
          <span className="font-normal text-text-muted">
            — আসল ডাটা থেকে হিসাব; প্রতিটি হারের পাশে লব/হর দেওয়া আছে
            {kpis ? ` · ${dhakaYmdOf(new Date(`${kpis.range.from}T00:00:00.000Z`))} থেকে ${kpis.range.to}` : ""}
          </span>
        </h2>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          পরিসর
          <select
            value={rangeKey}
            onChange={(e) => setRangeKey(e.target.value as RangeKey)}
            className="rounded-[8px] border border-border bg-card px-2 py-1.5 text-sm text-text-main outline-none focus:border-brand-500"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {failed ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          KPI লোড হয়নি — আবার চেষ্টা করুন। (অর্ডার তালিকা এতে প্রভাবিত হয়নি।)
        </p>
      ) : !kpis ? (
        <div role="status" aria-label="KPI লোড হচ্ছে" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="নতুন অর্ডার / ডেলিভারি হয়েছে"
            headline={`${kpis.ordersCreated} / ${kpis.ordersDelivered}`}
            detail="এই পরিসরে তৈরি অর্ডার / ডেলিভারি ইভেন্ট"
          />
          <KpiCard
            label="কনফার্মেশন হার"
            headline={rateHeadline(kpis.confirmationRate)}
            detail={`${kpis.confirmationRate.numerator}/${kpis.confirmationRate.denominator}টি অর্ডার কনফার্ম বা তার পরের ধাপে গেছে`}
          />
          <KpiCard
            label="ডেলিভারি সাফল্যের হার"
            headline={rateHeadline(kpis.deliverySuccessRate)}
            detail={`${kpis.deliverySuccessRate.numerator}/${kpis.deliverySuccessRate.denominator}টি শিপ করা অর্ডার ডেলিভারি হয়েছে`}
          />
          <KpiCard
            label="গড় অর্ডার মূল্য (AOV)"
            headline={kpis.averageOrderValue.averagePoisha === null ? "—" : formatBdt(kpis.averageOrderValue.averagePoisha)}
            detail={`ডেলিভারি হওয়া ${kpis.averageOrderValue.orders}টি অর্ডারে মোট ${formatBdt(kpis.averageOrderValue.totalPoisha)}`}
          />
          <KpiCard
            label="রিটার্ন হার"
            headline={rateHeadline(kpis.returnRate)}
            detail={`${kpis.returnRate.numerator}/${kpis.returnRate.denominator}টি ডেলিভারির বিপরীতে সম্পূর্ণ রিটার্ন`}
          />
          <KpiCard
            label="অগ্রিম আদায়ের হার"
            headline={rateHeadline(kpis.advanceCollectionRate)}
            detail={`${kpis.advanceCollectionRate.numerator}/${kpis.advanceCollectionRate.denominator}টি অগ্রিম-বাধ্যতামূলক অর্ডারে অগ্রিম মিলেছে`}
          />
          <KpiCard
            label="COD আদায়ের হার"
            headline={rateHeadline(kpis.codCollectionRate)}
            detail={`${formatBdt(kpis.codCollectionRate.collectedPoisha)} আদায় / ${formatBdt(kpis.codCollectionRate.duePoisha)} ডেলিভারি-COD মোট`}
          />
          <KpiCard
            label="বাতিলের হার"
            headline={rateHeadline(kpis.cancelRate)}
            detail={`${kpis.cancelRate.numerator}/${kpis.cancelRate.denominator}টি অর্ডার বাতিল হয়েছে`}
          />
        </div>
      )}
    </section>
  );
}
