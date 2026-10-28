"use client";

/**
 * BD Tools — অটো কুরিয়ার বাছাই panel (Agent 51; real history wired 2026-10-25).
 *
 * Runs the REAL pure assignment engine from src/bd/courier-assignment.ts
 * in the browser (same pattern as the address-parser panel): hard
 * filters -> weighted scoring -> deterministic tie-break, with the
 * full ranked list, exclusion reasons and the per-rule trace rendered.
 * The stats arrive as props from the server page, which builds them in
 * src/bd/courier-stats-db.ts: delivered/failed/returned counts, per-district
 * rates and average delivery days are aggregated from the real
 * Shipment tables; provider capabilities (zones, max weight, COD,
 * ETA) come from the provider catalogue — the only capability source
 * in the system. History and capabilities are labelled separately on
 * the panel so the two are never confused.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import {
  assignCourier,
  zoneForDistrict,
  type CourierAssignmentOrderFacts,
  type CourierAssignmentStats,
} from "@/bd/courier-assignment";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BD_TOOLS_STRINGS } from "./strings";

export interface CourierAssignmentPanelProps {
  stats: CourierAssignmentStats[];
  /** Shipments the history part of `stats` was aggregated from. */
  shipmentCount: number;
  providersWithHistory: number;
}

const DISTRICTS = [
  "Dhaka",
  "Chattogram",
  "Khulna",
  "Rajshahi",
  "Sylhet",
  "Barishal",
  "Cumilla",
  "Narayanganj",
  "Gazipur",
  "Mymensingh",
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  steadfast: "Steadfast",
  pathao: "Pathao",
  redx: "RedX",
  paperfly: "Paperfly",
  ecourier: "eCourier",
};

const inputClass =
  "w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";

export function CourierAssignmentPanel({ stats, shipmentCount, providersWithHistory }: CourierAssignmentPanelProps) {
  const { locale } = useLocale();
  const s = pick(locale, BD_TOOLS_STRINGS);
  const [district, setDistrict] = useState<string>("Dhaka");
  const [weight, setWeight] = useState("800");
  const [codTaka, setCodTaka] = useState("1500");
  const [fragile, setFragile] = useState(false);
  const [highValue, setHighValue] = useState(false);

  const result = useMemo(() => {
    const weightGrams = Math.max(1, Math.floor(Number(weight) || 0));
    const codAmountPoisha = Math.max(0, Math.round((Number(codTaka) || 0) * 100));
    const order: CourierAssignmentOrderFacts = {
      orderId: null,
      district,
      zone: zoneForDistrict(district),
      weightGrams,
      codAmountPoisha,
      fragile,
      highValue,
    };
    return assignCourier(order, stats);
  }, [district, weight, codTaka, fragile, highValue, stats]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        {s.caIntro}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">
          {interpolate(s.caHistoryBadge, { shipments: shipmentCount, providers: providersWithHistory })}
        </Badge>
        {result.chosen ? (
          <Badge tone="success">{interpolate(s.caChosenBadge, { provider: PROVIDER_LABELS[result.chosen.provider] ?? result.chosen.provider, score: result.chosen.score ?? "—" })}</Badge>
        ) : (
          <Badge tone="danger">{s.caNoneBadge}</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">{s.caDistrict}</span>
          <select value={district} onChange={(e) => setDistrict(e.target.value)} className={inputClass}>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">{s.caWeight}</span>
          <input type="number" min={1} value={weight} onChange={(e) => setWeight(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">{s.caCod}</span>
          <input type="number" min={0} value={codTaka} onChange={(e) => setCodTaka(e.target.value)} className={inputClass} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
          {s.caFragile}
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={highValue} onChange={(e) => setHighValue(e.target.checked)} />
          {s.caHighValue}
        </label>
      </div>
      <p className="text-xs text-text-muted">
        {s.caZoneLine1}
        <span className="font-mono">{result.order.zone}</span>
        {interpolate(s.caZoneLine2, { weight: result.order.weightGrams })}
        <Money poisha={result.order.codAmountPoisha} />
        {result.order.fragile || result.order.highValue ? s.caCareNote : ""}
      </p>

      <div className="space-y-2">
        {result.ranked.map((r, i) => (
          <div
            key={r.provider}
            className={`rounded-lg border p-3 ${i === 0 ? "border-success-solid/40 bg-success-soft" : "border-border bg-surface-2"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                #{i + 1} {PROVIDER_LABELS[r.provider] ?? r.provider}
                {i === 0 ? <span className="ml-2 text-success-solid">{s.caRecommended}</span> : null}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={i === 0 ? "success" : "info"}>{interpolate(s.caScoreBadge, { score: r.score ?? "—" })}</Badge>
                <span>{s.caCharge}<Money poisha={r.chargePoisha ?? 0} /></span>
                <span className="text-text-muted">{interpolate(s.caEta, { days: r.estimatedDays ?? "—" })}</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {interpolate(s.caDeliveryRate, {
                rate: r.deliveryRateBps !== null ? `${(r.deliveryRateBps / 100).toFixed(1)}%` : "—",
                rate2: r.returnRateBps !== null ? `${(r.returnRateBps / 100).toFixed(1)}%` : "—",
              })}
            </p>
            <ul className="mt-1 list-inside list-disc text-xs">
              {(locale === "bn" ? r.reasonsBn : r.reasonsEn).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {result.excluded.length > 0 ? (
        <div>
          <h3 className="mb-2 font-display text-sm font-semibold text-text-main">{s.caExcludedTitle}</h3>
          <ul className="space-y-1 text-sm text-text-muted">
            {result.excluded.map((r) => (
              <li key={r.provider}>
                <span className="font-medium text-text-main">{PROVIDER_LABELS[r.provider] ?? r.provider}</span>
                {" — "}
                {(locale === "bn" ? r.exclusionReasonsBn : r.exclusionReasonsEn).join(" ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details>
        <summary className="cursor-pointer font-display text-sm font-semibold text-text-main">{s.caTraceTitle}</summary>
        <ul className="mt-2 space-y-1 font-mono text-xs text-text-muted">
          {result.trace.map((t, i) => (
            <li key={i}>
              [{t.step}/{t.rule}] {t.provider ?? "—"}: {t.matched ? "✓" : "✗"} {locale === "bn" ? t.messageBn : t.messageEn}
            </li>
          ))}
        </ul>
      </details>

      <p className="text-xs text-text-muted">
        {s.caNote1}
        {shipmentCount === 0 ? s.caNoteNoHistory : ""}
        {s.caNote2}
      </p>
    </div>
  );
}
