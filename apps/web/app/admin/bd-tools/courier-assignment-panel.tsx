"use client";

/**
 * BD Tools — অটো কুরিয়ার বাছাই panel (Agent 51; real history wired 2026-10-25).
 *
 * Runs the REAL pure assignment engine from src/bd/courier-assignment.ts
 * in the browser (same pattern as the address-parser panel): hard
 * filters -> weighted scoring -> deterministic tie-break, with the
 * full ranked list, exclusion reasons and the per-rule trace rendered.
 * The stats arrive as props from the server page, which builds them in
 * ./courier-stats.ts: delivered/failed/returned counts, per-district
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
        অর্ডারের জেলা, ওজন আর COD টাকা দিলেই ইঞ্জিন যোগ্য কুরিয়ারদের র‌্যাংক করে দেবে — হার্ড ফিল্টার
        (নিষ্ক্রিয় / জোন নেই / ওজন বেশি / COD নেয় না) আগে, তারপর ডেলিভারি হার, রিটার্ন, চার্জ, ETA ও
        জেলার আগের রেকর্ড দিয়ে স্কোর। কোনো আসল কুরিয়ার API কল হয় না।
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">
          ইতিহাস: ডাটাবেসের {shipmentCount}টি শিপমেন্ট ({providersWithHistory}টি প্রোভাইডার) · সক্ষমতা: প্রোভাইডার ক্যাটালগ
        </Badge>
        {result.chosen ? (
          <Badge tone="success">✓ সুপারিশ: {PROVIDER_LABELS[result.chosen.provider] ?? result.chosen.provider} · স্কোর {result.chosen.score}/১০০</Badge>
        ) : (
          <Badge tone="danger">⚠ কোনো কুরিয়ার যোগ্য নয়</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">জেলা (District)</span>
          <select value={district} onChange={(e) => setDistrict(e.target.value)} className={inputClass}>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">ওজন (গ্রাম)</span>
          <input type="number" min={1} value={weight} onChange={(e) => setWeight(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">COD টাকা (৳) — ০ = প্রিপেইড</span>
          <input type="number" min={0} value={codTaka} onChange={(e) => setCodTaka(e.target.value)} className={inputClass} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
          ভঙ্গুর (fragile)
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={highValue} onChange={(e) => setHighValue(e.target.checked)} />
          উচ্চমূল্য (high-value)
        </label>
      </div>
      <p className="text-xs text-text-muted">
        জোন: <span className="font-mono">{result.order.zone}</span> (জেলা থেকে zoneForDistrict দিয়ে) ·
        ওজন {result.order.weightGrams} গ্রাম · COD <Money poisha={result.order.codAmountPoisha} />
        {result.order.fragile || result.order.highValue ? " · যত্ন (care) স্কোর সক্রিয় — রিটার্ন হার বাড়তি গুরুত্ব পাচ্ছে" : ""}
      </p>

      <div className="space-y-2">
        {result.ranked.map((r, i) => (
          <div
            key={r.provider}
            className={`rounded-lg border p-3 ${i === 0 ? "border-emerald-300 bg-emerald-50" : "border-border bg-surface-2"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                #{i + 1} {PROVIDER_LABELS[r.provider] ?? r.provider}
                {i === 0 ? <span className="ml-2 text-emerald-700">★ সুপারিশকৃত</span> : null}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={i === 0 ? "success" : "info"}>স্কোর {r.score}/১০০</Badge>
                <span>চার্জ <Money poisha={r.chargePoisha ?? 0} /></span>
                <span className="text-text-muted">ETA {r.estimatedDays ?? "—"} দিন</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              ডেলিভারি হার {r.deliveryRateBps !== null ? `${(r.deliveryRateBps / 100).toFixed(1)}%` : "—"} ·
              রিটার্ন হার {r.returnRateBps !== null ? `${(r.returnRateBps / 100).toFixed(1)}%` : "—"}
            </p>
            <ul className="mt-1 list-inside list-disc text-xs">
              {r.reasonsBn.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {result.excluded.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">বাদ পড়েছে (হার্ড ফিল্টার)</h3>
          <ul className="space-y-1 text-sm text-text-muted">
            {result.excluded.map((r) => (
              <li key={r.provider}>
                <span className="font-medium text-text-main">{PROVIDER_LABELS[r.provider] ?? r.provider}</span>
                {" — "}
                {r.exclusionReasonsBn.join(" ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details>
        <summary className="cursor-pointer text-sm font-medium">নিয়মের ট্রেস (প্রতি নিয়মে কী হলো)</summary>
        <ul className="mt-2 space-y-1 font-mono text-xs text-text-muted">
          {result.trace.map((t, i) => (
            <li key={i}>
              [{t.step}/{t.rule}] {t.provider ?? "—"}: {t.matched ? "✓" : "✗"} {t.messageEn}
            </li>
          ))}
        </ul>
      </details>

      <p className="text-xs text-text-muted">
        দ্রষ্টব্য: ডেলিভারি/ফেল/রিটার্ন সংখ্যা, জেলা-ভিত্তিক হার ও গড় ডেলিভারি সময় ডাটাবেসের আসল
        শিপমেন্ট ইতিহাস থেকে হিসাব করা; জোন/সর্বোচ্চ ওজন/COD/ETA প্রোভাইডার ক্যাটালগ থেকে আসে
        (সিস্টেমে সক্ষমতার অন্য কোনো উৎস নেই)।
        {shipmentCount === 0
          ? " এখনো কোনো শিপমেন্ট ইতিহাস নেই — তাই স্কোর শুধু চার্জ/ETA/ক্যাটালগের ওপর দাঁড়িয়ে; প্রথম শিপমেন্টগুলো ডেলিভারি হলেই ইতিহাস-ভিত্তিক স্কোর চালু হবে।"
          : ""}
        {" "}স্টাফ অন্য কুরিয়ার বেছে নিলে সেটা manual override — ইঞ্জিনের সুপারিশ সিদ্ধান্তে পাশাপাশি
        রেকর্ড থাকে, মুছে যায় না।
      </p>
    </div>
  );
}
