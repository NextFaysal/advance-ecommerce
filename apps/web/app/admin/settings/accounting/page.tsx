import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
import { getSetting } from "@/lib/settings";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { SETTINGS_STRINGS } from "../strings";
import { VatRateCard } from "./vat-card";

// Admin > Settings > Accounting — the VAT rate card (wave 16).
// Until now the sales-VAT rate (Settings key `accounting.vat_rate_bps`,
// wave 7) could only be changed by writing the Settings store
// directly — the ERP VAT report read it, but there was no UI. This
// page is that UI: it reads the current stored value server-side
// (the key is not public, so the client never fetches it directly)
// and the card saves through the standard Settings API, which
// requires a reason and writes the settings.update audit row.
// Nothing about the VAT computation changes here.
export const dynamic = "force-dynamic";

/**
 * The effective rate, parsed with EXACTLY the rule the order flow
 * uses (orders/repository.readConfiguredVatRateBps): unset, blank,
 * non-integer, <= 0 or > 10000 (basis points) all mean "not
 * configured" — order creation then records no VAT split.
 */
function effectiveVatRateBps(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const rate = Number.parseInt(raw, 10);
  if (!Number.isInteger(rate) || rate <= 0 || rate > 10000) return null;
  return rate;
}

export default async function AccountingSettingsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  let raw: string | null = null;
  let dbReady = true;
  try {
    raw = await getSetting("accounting.vat_rate_bps");
  } catch {
    dbReady = false;
  }
  const initialBps = effectiveVatRateBps(raw);

  return (
    <main className="min-w-0">
      <PageHeader
        title={s.accTitle}
        description={s.accDesc}
        breadcrumb={s.accBreadcrumb}
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            {s.allSettings}
          </Link>
        }
      />

      <section className="mt-6 rounded-2xl border border-border/60 bg-card p-5 shadow-card">
        <h2 className="flex items-center gap-2.5 font-display text-base font-semibold text-text-main">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
            <Icon name="info" size={17} />
          </span>
          {s.accWhatTitle}
        </h2>
        <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-text-muted">
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              {s.accWhat1A}<strong>{s.accWhat1Bold}</strong>{s.accWhat1B}<span className="font-mono text-xs">vatPoisha</span>{s.accWhat1C}<span className="font-mono text-xs">vatRateBps</span>{s.accWhat1D}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              {s.accWhat2A}<Link href="/admin/erp" className="font-medium text-brand-700 underline">{s.accWhat2Link}</Link>{s.accWhat2B}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>{s.accWhat3A}<strong>{s.accWhat3Bold}</strong>{s.accWhat3B}</span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>{s.accWhat4A}<strong>{s.accWhat4Bold}</strong>{s.accWhat4B}</span>
          </li>
        </ul>
      </section>

      <div className="mt-6">
        <VatRateCard initialBps={initialBps} initialRaw={raw ?? ""} dbReady={dbReady} />
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-text-muted">
        {s.accFooterA}<code className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs ring-1 ring-inset ring-black/5">accounting.vat_rate_bps</code>{s.accFooterB}<span className="font-mono text-xs">settings.update</span>{s.accFooterC}
      </p>
    </main>
  );
}
