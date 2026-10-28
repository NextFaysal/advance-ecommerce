"use client";

/**
 * POS sales panel (doc 17, batch O9-2) — mounted on the admin orders
 * page under the KPI panel so the orders team can see the physical
 * counter's sales next to the online orders. Data: GET
 * /api/v1/admin/orders/pos-sales (src/orders/pos-sales), range select
 * mirrors the KPI panel (today / last 7 / last 30 Dhaka days).
 *
 * READ-ONLY by design, and the copy says why: a POS sale already
 * moved its stock inside the POS flow, so these sales are reported
 * here — never converted into Orders (that would double-count stock
 * and revenue). The register itself lives at /admin/pos.
 */
import { useEffect, useState } from "react";
import { formatBdt } from "../../../src/checkout/pricing";
import { shiftYmd, todayDhakaYmd } from "../../../src/lib/dhaka-date";
import { pick, intlLocale, type Locale } from "../../../src/i18n/locale";
import { useLocale } from "../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "./strings";

interface PosSaleRow {
  id: string;
  receiptRef: string;
  createdAt: string;
  totalPoisha: number;
  paymentMethod: string;
  itemsCount: number;
  cashierLabel?: string;
  registerName?: string;
}

interface PosSalesReport {
  range: { from: string; to: string };
  rows: PosSaleRow[];
  count: number;
  totalPoisha: number;
  rowsTruncated: boolean;
}

type RangeKey = "today" | "7d" | "30d";

const RANGE_OPTIONS: Array<{ key: RangeKey; label: Record<Locale, string>; days: number }> = [
  { key: "today", label: { bn: "আজ", en: "Today" }, days: 0 },
  { key: "7d", label: { bn: "শেষ ৭ দিন", en: "Last 7 days" }, days: 6 },
  { key: "30d", label: { bn: "শেষ ৩০ দিন", en: "Last 30 days" }, days: 29 },
];

const METHOD_LABEL: Record<string, Record<Locale, string>> = {
  CASH: { bn: "নগদ", en: "Cash" },
  BKASH: { bn: "বিকাশ", en: "bKash" },
  NAGAD: { bn: "নগদ (Nagad)", en: "Cash (Nagad)" },
  CARD: { bn: "কার্ড", en: "Card" },
};

function rangeFor(key: RangeKey): { from: string; to: string } {
  const to = todayDhakaYmd();
  const days = RANGE_OPTIONS.find((o) => o.key === key)?.days ?? 29;
  return { from: shiftYmd(to, -days), to };
}

export function PosSalesPanel() {
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const [report, setReport] = useState<PosSalesReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const { from, to } = rangeFor(rangeKey);
        const res = await fetch(`/api/v1/admin/orders/pos-sales?from=${from}&to=${to}`);
        const body = (await res.json().catch(() => null)) as { data?: PosSalesReport } | null;
        if (cancelled) return;
        if (res.ok && body?.data) setReport(body.data);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeKey]);

  return (
    <section aria-label={s.posAria} className="mt-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3">{s.posTitle}</h2>
          <p className="mt-0.5 max-w-2xl text-small leading-relaxed text-text-muted">
            {s.posIntro1}{" "}
            <a href="/admin/pos" className="font-semibold text-brand-700 hover:underline">
              {s.posRegister}
            </a>{" "}
            {s.posIntro2}
          </p>
        </div>
        <div className="flex gap-1.5" role="group" aria-label={s.rangeAria}>
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setRangeKey(o.key)}
              aria-pressed={rangeKey === o.key}
              className={`min-h-[36px] rounded-xl px-3 text-small font-semibold transition duration-fast ease-smooth ${
                rangeKey === o.key
                  ? "bg-brand-600 text-white"
                  : "border border-border bg-card hover:bg-surface-2"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300`}
            >
              {pick(locale, o.label)}
            </button>
          ))}
        </div>
      </div>

      {failed && (
        <p role="alert" className="mt-3 text-small text-danger">
          {s.posLoadFail}
        </p>
      )}
      {!failed && !report && (
        <p role="status" className="mt-3 text-small text-text-muted">
          {t.loading}
        </p>
      )}
      {report && (
        <>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-small">
            <span>
              {s.posTotalSales}{" "}
              <span className="tnum font-bold">{formatBdt(report.totalPoisha)}</span>
            </span>
            <span className="text-text-muted">
              {report.count.toLocaleString(intlLocale(locale))} {s.posReceipts}
              {report.rowsTruncated ? ` ${s.posTruncated1} ${report.rows.length.toLocaleString(intlLocale(locale))}${s.posTruncated2}` : ""}
            </span>
          </div>
          {report.rows.length === 0 ? (
            <p className="mt-3 text-small text-text-muted">{s.posEmpty}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-small">
                <thead>
                  <tr className="border-b border-border text-caption uppercase tracking-wide text-text-subtle">
                    <th className="py-2 pr-3 font-semibold">{s.posColReceipt}</th>
                    <th className="py-2 pr-3 font-semibold">{s.posColTime}</th>
                    <th className="py-2 pr-3 font-semibold">{s.posColCashier}</th>
                    <th className="py-2 pr-3 font-semibold">{s.posColPayment}</th>
                    <th className="py-2 pr-3 text-right font-semibold">{s.posColItems}</th>
                    <th className="py-2 text-right font-semibold">{s.posColTotal}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3 font-mono font-semibold">{r.receiptRef}</td>
                      <td className="py-2 pr-3 text-text-muted">
                        {new Date(r.createdAt).toLocaleString(intlLocale(locale), { timeZone: "Asia/Dhaka" })}
                      </td>
                      <td className="py-2 pr-3 text-text-muted">
                        {[r.cashierLabel, r.registerName].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="py-2 pr-3">{METHOD_LABEL[r.paymentMethod] ? pick(locale, METHOD_LABEL[r.paymentMethod]) : r.paymentMethod}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.itemsCount.toLocaleString(intlLocale(locale))}</td>
                      <td className="tnum py-2 text-right font-semibold">
                        {formatBdt(r.totalPoisha)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
