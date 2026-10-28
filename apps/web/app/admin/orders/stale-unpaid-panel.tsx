"use client";

/**
 * Stale-unpaid work list panel (doc 17, O3) — mounted on the admin
 * orders page. Fetches GET /api/v1/admin/orders/stale-unpaid?hours=24
 * and renders a compact warning card ONLY when stale orders exist
 * (a zero state renders nothing — the orders page stays clean).
 * Expanding shows the rows: order link, age, total, advance due,
 * method, masked phone (the endpoint never returns a full number).
 *
 * The copy is deliberately honest: automatic cancellation is NOT
 * active (it arrives with the VPS worker) — this is a list for staff
 * to work by hand, not a sweep.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "../../../src/components/ui/badge";
import { Icon } from "../../../src/components/ui/icon";
import { formatBdt } from "../../../src/checkout/pricing";
import { pick, type Locale } from "../../../src/i18n/locale";
import { useLocale } from "../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "./strings";

interface StaleRow {
  id: string;
  orderNo: string;
  createdAt: string;
  ageHours: number;
  totalPoisha: number;
  advanceRequiredPoisha: number;
  advanceSatisfied: boolean;
  paymentMethod: string;
  customerPhoneMasked: string;
}

interface StaleResponse {
  data: StaleRow[];
  meta: { total: number; hours: number; autoCancelActive: boolean };
}

/* OD6 (doc 19 §3-S6) — age ramp + label in the aging panel's language
 * (app/admin/orders/aging-panel.tsx): identical thresholds and the
 * "{age} ধরে আটকে" phrasing, so a stuck order reads the same here as
 * on the aging board. */
function ageChipClass(ageHours: number): string {
  if (ageHours >= 7 * 24) return "bg-danger-soft text-danger";
  if (ageHours >= 5 * 24) return "bg-warning-soft text-warning-solid ring-1 ring-inset ring-warning-solid/25";
  if (ageHours >= 48) return "bg-warning-soft text-warning-solid";
  return "bg-surface-2 text-text-muted";
}

function ageLabel(ageHours: number, locale: Locale): string {
  const s = pick(locale, ORDER_STRINGS);
  if (ageHours >= 48) return `${Math.floor(ageHours / 24)} ${s.ageDays}`;
  return `${Math.round(ageHours)} ${s.ageHours}`;
}

const METHOD_LABEL: Record<string, Record<Locale, string>> = {
  COD: { bn: "ক্যাশ অন ডেলিভারি", en: "Cash on Delivery" },
  BKASH: { bn: "বিকাশ", en: "bKash" },
  NAGAD: { bn: "নগদ", en: "Nagad" },
  ROCKET: { bn: "রকেট", en: "Rocket" },
  UPAY: { bn: "উপায়", en: "Upay" },
  SSLCOMMERZ: { bn: "SSLCommerz", en: "SSLCommerz" },
  AAMARPAY: { bn: "আমারপে", en: "AamarPay" },
  SHURJOPAY: { bn: "সূর্যপে", en: "ShurjoPay" },
  MANUAL_MOBILE_BANKING: { bn: "ম্যানুয়াল মোবাইল ব্যাংকিং", en: "Manual mobile banking" },
};

export function StaleUnpaidPanel() {
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [state, setState] = useState<StaleResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/orders/stale-unpaid?hours=24");
        if (!res.ok) return;
        const json = (await res.json()) as StaleResponse;
        if (!cancelled) setState(json);
      } catch {
        // Silent: the panel is an add-on — the orders list below is
        // the page's real job and must not be disturbed by it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === null || state.meta.total === 0) return null;
  const { data, meta } = state;

  return (
    <section className="mb-4 rounded-2xl border border-border/60 bg-warning-soft p-4 shadow-xs" aria-label={s.staleAria}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="warning" icon={<Icon name="clock" size={12} />}>
          {meta.total} {s.staleDue}
        </Badge>
        <p className="text-body font-medium text-text-main">
          {s.staleTitle1} {meta.hours} {s.staleTitle2}
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto rounded-xl border border-border bg-surface px-3 py-1.5 text-small font-medium text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          aria-expanded={expanded}
        >
          {expanded ? s.hide : s.staleShowList}
        </button>
      </div>
      <p className="mt-2 text-small text-text-muted">
        {s.staleNote}
      </p>
      {expanded && (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
          {data.map((row) => (
            <li key={row.id} className="flex flex-col gap-1.5 px-3 py-2 text-small sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
              <Link href={`/admin/orders/${row.id}`} className="font-semibold text-brand-700 hover:underline">
                {row.orderNo}
              </Link>
              <span
                className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-caption font-semibold ${ageChipClass(row.ageHours)}`}
              >
                {ageLabel(row.ageHours, locale)} {s.ageStuckSuffix}
              </span>
              <span>{METHOD_LABEL[row.paymentMethod] ? pick(locale, METHOD_LABEL[row.paymentMethod]) : row.paymentMethod}</span>
              <span>{s.totalWord} {formatBdt(row.totalPoisha)}</span>
              {row.advanceRequiredPoisha > 0 ? (
                row.advanceSatisfied ? (
                  <Badge tone="success" icon={<Icon name="check" size={12} />}>
                    {s.staleAdvancePaid} {formatBdt(row.advanceRequiredPoisha)}
                  </Badge>
                ) : (
                  <Badge tone="warning" icon={<Icon name="clock" size={12} />}>
                    {s.staleAdvanceDue} {formatBdt(row.advanceRequiredPoisha)}
                  </Badge>
                )
              ) : null}
              <span className="text-text-muted sm:ml-auto">{row.customerPhoneMasked}</span>
            </li>
          ))}
          {meta.total > data.length && (
            <li className="px-3 py-2 text-small text-text-muted">
              {s.staleMore1} {meta.total - data.length} {s.staleMore2} {data.length}{s.staleMore3}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
