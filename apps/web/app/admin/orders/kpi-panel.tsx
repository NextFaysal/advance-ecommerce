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
import { Card } from "../../../src/components/ui/card";
import { Icon, type IconName } from "../../../src/components/ui/icon";
import { ORDER_DENSITY } from "../../../src/orders/components/density";
import { interpolate, pick, type Locale } from "../../../src/i18n/locale";
import { useLocale } from "../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "./strings";

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

const RANGE_OPTIONS: Array<{ key: RangeKey; label: Record<Locale, string>; days: number }> = [
  { key: "today", label: { bn: "আজ", en: "Today" }, days: 0 },
  { key: "7d", label: { bn: "শেষ ৭ দিন", en: "Last 7 days" }, days: 6 },
  { key: "30d", label: { bn: "শেষ ৩০ দিন", en: "Last 30 days" }, days: 29 },
];

function rangeFor(key: RangeKey): { from: string; to: string } {
  const to = todayDhakaYmd();
  const days = RANGE_OPTIONS.find((o) => o.key === key)?.days ?? 29;
  return { from: shiftYmd(to, -days), to };
}

/**
 * OD4 (doc 19 §3-S4) — stat-card form of the KPI tile: icon chip +
 * mono hero value in the StatCard visual language, sized by the OD0
 * comfortable density tokens. The rate's numerator/denominator ride
 * in a neutral fraction chip AND in the detail sentence — always
 * visible, never behind the percentage alone. (ui/StatCard's own
 * delta chip is a trend indicator; these rates have no trend series,
 * so no trend arrow is rendered — that would fabricate one.)
 */
function KpiCard({
  label,
  headline,
  detail,
  icon,
  accent,
  fraction,
}: {
  label: string;
  headline: string;
  detail: string;
  icon: IconName;
  accent: string;
  fraction?: string;
}) {
  return (
    <Card className={ORDER_DENSITY.comfortable.panel}>
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] shadow-sm ${accent}`}
        >
          <Icon name={icon} size={20} />
        </span>
        {fraction ? (
          <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-1 font-mono text-xs font-semibold leading-none tabular-nums text-text-muted ring-1 ring-inset ring-black/5">
            {fraction}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-[1.55rem] font-bold leading-8 tabular-nums text-text-main">{headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">{detail}</p>
    </Card>
  );
}

function rateHeadline(rate: KpiRate): string {
  return rate.ratePercent === null ? "—" : `${rate.ratePercent}%`;
}

export function KpiPanel() {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
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
    <section aria-label={s.kpiTitle} className={`mb-4 rounded-lg border border-border bg-surface-2 ${ORDER_DENSITY.comfortable.panel}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {s.kpiTitle}{" "}
          <span className="font-normal text-text-muted">
            {s.kpiSubtitle}
            {kpis
              ? interpolate(s.kpiRangePart, {
                  from: dhakaYmdOf(new Date(`${kpis.range.from}T00:00:00.000Z`)),
                  to: kpis.range.to,
                })
              : ""}
          </span>
        </h2>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          {s.kpiRangeLabel}
          <select
            value={rangeKey}
            onChange={(e) => setRangeKey(e.target.value as RangeKey)}
            className="rounded-[8px] border border-border bg-card px-2 py-1.5 text-sm text-text-main outline-none focus:border-brand-500"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {pick(locale, o.label)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {failed ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {s.kpiLoadFail}
        </p>
      ) : !kpis ? (
        <div role="status" aria-label={s.kpiLoadingAria} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-[132px] animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label={s.kpiNewOrders}
            headline={`${kpis.ordersCreated} / ${kpis.ordersDelivered}`}
            detail={s.kpiNewOrdersDetail}
            icon="package"
            accent="bg-brand-50 text-brand-600"
          />
          <KpiCard
            label={s.kpiConfirmRate}
            headline={rateHeadline(kpis.confirmationRate)}
            detail={interpolate(s.kpiConfirmDetail, { n: kpis.confirmationRate.numerator, d: kpis.confirmationRate.denominator })}
            icon="check"
            accent="bg-sky-50 text-sky-600"
            fraction={`${kpis.confirmationRate.numerator}/${kpis.confirmationRate.denominator}`}
          />
          <KpiCard
            label={s.kpiDeliveryRate}
            headline={rateHeadline(kpis.deliverySuccessRate)}
            detail={interpolate(s.kpiDeliveryDetail, { n: kpis.deliverySuccessRate.numerator, d: kpis.deliverySuccessRate.denominator })}
            icon="truck"
            accent="bg-emerald-50 text-emerald-600"
            fraction={`${kpis.deliverySuccessRate.numerator}/${kpis.deliverySuccessRate.denominator}`}
          />
          <KpiCard
            label={s.kpiAov}
            headline={kpis.averageOrderValue.averagePoisha === null ? "—" : formatBdt(kpis.averageOrderValue.averagePoisha)}
            detail={interpolate(s.kpiAovDetail, { n: kpis.averageOrderValue.orders, total: formatBdt(kpis.averageOrderValue.totalPoisha) })}
            icon="chart"
            accent="bg-violet-50 text-violet-600"
          />
          <KpiCard
            label={s.kpiReturnRate}
            headline={rateHeadline(kpis.returnRate)}
            detail={interpolate(s.kpiReturnDetail, { n: kpis.returnRate.numerator, d: kpis.returnRate.denominator })}
            icon="rotate-ccw"
            accent="bg-amber-50 text-amber-600"
            fraction={`${kpis.returnRate.numerator}/${kpis.returnRate.denominator}`}
          />
          <KpiCard
            label={s.kpiAdvanceRate}
            headline={rateHeadline(kpis.advanceCollectionRate)}
            detail={interpolate(s.kpiAdvanceDetail, { n: kpis.advanceCollectionRate.numerator, d: kpis.advanceCollectionRate.denominator })}
            icon="credit-card"
            accent="bg-teal-50 text-teal-600"
            fraction={`${kpis.advanceCollectionRate.numerator}/${kpis.advanceCollectionRate.denominator}`}
          />
          <KpiCard
            label={s.kpiCodRate}
            headline={rateHeadline(kpis.codCollectionRate)}
            detail={interpolate(s.kpiCodDetail, { collected: formatBdt(kpis.codCollectionRate.collectedPoisha), due: formatBdt(kpis.codCollectionRate.duePoisha) })}
            icon="banknote"
            accent="bg-emerald-50 text-emerald-600"
          />
          <KpiCard
            label={s.kpiCancelRate}
            headline={rateHeadline(kpis.cancelRate)}
            detail={interpolate(s.kpiCancelDetail, { n: kpis.cancelRate.numerator, d: kpis.cancelRate.denominator })}
            icon="x"
            accent="bg-rose-50 text-rose-600"
            fraction={`${kpis.cancelRate.numerator}/${kpis.cancelRate.denominator}`}
          />
        </div>
      )}
    </section>
  );
}
