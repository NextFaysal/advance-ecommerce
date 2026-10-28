"use client";

/**
 * Abandoned checkouts — REAL data from GET /api/v1/admin/abandoned
 * (wave 22, doc 17 batch O4). Lists the captures the storefront
 * recorded when a shopper typed a valid phone + had cart items but
 * left without ordering. Phones arrive MASKED from the API (the full
 * number never reaches the browser); the call-task action hands the
 * number to the call centre server-side instead.
 *
 * Actions: "কল টাস্ক" (create an ABANDONED_CHECKOUT call task),
 * "অর্ডারে রূপান্তর" (convert — re-priced at CURRENT catalog prices
 * into a real COD order via the server funnel; confirmed first), and
 * "বাতিল" (dismiss). Captures expire 7 days after capture and drop
 * off this list — stated in the header copy, never hidden.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/admin-shell/PageHeader";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { formatBdt } from "../../../src/checkout/pricing";
import { interpolate, pick } from "../../../src/i18n/locale";
import { useLocale } from "../../../src/i18n/LocaleProvider";
import { ABANDONED_STRINGS, type AbandonedStrings } from "./strings";

interface AbandonedItem {
  variantId: string;
  quantity: number;
  pricePoishaAtCapture: number;
  productName: string | null;
  sku: string | null;
}

interface AbandonedRow {
  id: string;
  customerPhoneMasked: string;
  customerName: string | null;
  items: AbandonedItem[];
  itemCount: number;
  subtotalPoisha: number;
  address: {
    division?: string;
    district?: string;
    upazila?: string;
    addressLine?: string;
  } | null;
  hasCallTask: boolean;
  createdAt: string;
  lastSeenAt: string;
  ageMinutes: number;
}

interface ListResponse {
  data: AbandonedRow[];
  meta: { total: number; expiresAfterDays: number };
}

function ageLabel(ageMinutes: number, s: AbandonedStrings): string {
  if (ageMinutes < 1) return s.ageJustNow;
  if (ageMinutes < 60) return interpolate(s.ageMinutes, { n: ageMinutes });
  const hours = Math.floor(ageMinutes / 60);
  if (hours < 24) return interpolate(s.ageHours, { n: hours });
  return interpolate(s.ageDays, { n: Math.floor(hours / 24) });
}

/* OD6 (doc 19 §3-S6) — age ramp in the aging panel's language
 * (app/admin/orders/aging-panel.tsx): the longer a capture has sat,
 * the hotter the chip. Thresholds mirror ageChipClass there. */
function ageChipClass(ageMinutes: number): string {
  const ageHours = ageMinutes / 60;
  if (ageHours >= 7 * 24) return "bg-danger-solid text-white";
  if (ageHours >= 5 * 24) return "bg-danger-soft text-danger";
  if (ageHours >= 48) return "bg-warning-soft text-warning-solid";
  return "bg-surface-2 text-text-muted";
}

export default function AdminAbandonedPage() {
  const { locale } = useLocale();
  const s = pick(locale, ABANDONED_STRINGS);
  const [rows, setRows] = useState<AbandonedRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/abandoned");
      if (!res.ok) {
        setLoadError(s.loadError);
        return;
      }
      const json = (await res.json()) as ListResponse;
      setRows(json.data);
      setTotal(json.meta.total);
      setLoadError(null);
    } catch {
      setLoadError(s.loadError);
    }
  }, [s]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: "call-task" | "convert" | "dismiss") {
    if (action === "convert") {
      const ok = window.confirm(s.confirmConvert);
      if (!ok) return;
    }
    if (action === "dismiss") {
      const ok = window.confirm(s.confirmDismiss);
      if (!ok) return;
    }
    setBusyId(id);
    setNotice(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/admin/abandoned/${id}/${action}`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as {
        data?: { orderNo?: string };
        meta?: { alreadyConverted?: boolean };
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setActionError(json?.error?.message ?? s.actionFailed);
        return;
      }
      if (action === "convert") {
        setNotice(
          json?.meta?.alreadyConverted
            ? interpolate(s.alreadyConverted, { orderNo: json?.data?.orderNo ?? "" })
            : interpolate(s.orderCreated, { orderNo: json?.data?.orderNo ?? "" }),
        );
      } else if (action === "call-task") {
        setNotice(s.callTaskCreated);
      } else {
        setNotice(s.captureDismissed);
      }
      await load();
    } catch {
      setActionError(s.networkError);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="space-y-6">
      <PageHeader title={s.title} subtitle={s.description} />

      {notice && (
        <p role="status" className="mb-4 rounded-xl bg-success-soft px-3.5 py-2.5 text-small text-success-solid">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-4 rounded-xl bg-danger-soft px-3.5 py-2.5 text-small text-danger">
          {actionError}
        </p>
      )}

      {loadError && (
        <Card>
          <p className="text-sm text-danger">{loadError}</p>
        </Card>
      )}

      {rows === null && !loadError && (
        <div className="grid gap-3 sm:gap-4" aria-hidden="true">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {rows !== null && rows.length === 0 && !loadError && (
        <EmptyState title={s.emptyTitle} description={s.emptyDescription} />
      )}

      {rows !== null && rows.length > 0 && (
        <>
          {/* Recovery strip (OD6): everything below is computed ONLY
              from the rows this page loaded. The API returns no grand
              total value, so when the list is truncated the money is
              labelled as this page's sum — never presented as the
              all-captures total. */}
          <Card className="mb-3">
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <p className="text-caption font-medium text-text-subtle">{s.openCaptures}</p>
                <p className="tnum mt-0.5 text-lg font-bold text-text-main">{interpolate(s.openCount, { total })}</p>
              </div>
              <div>
                <p className="text-caption font-medium text-text-subtle">
                  {s.potentialSales}
                  {total > rows.length ? interpolate(s.potentialSalesPageSuffix, { n: rows.length }) : ""}
                </p>
                <p className="tnum mt-0.5 text-lg font-bold text-text-main">
                  {formatBdt(rows.reduce((s, r) => s + r.subtotalPoisha, 0))}
                </p>
              </div>
              <div>
                <p className="text-caption font-medium text-text-subtle">{s.oldest}</p>
                <p className="mt-0.5">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold ${ageChipClass(Math.max(...rows.map((r) => r.ageMinutes)))}`}
                  >
                    {ageLabel(Math.max(...rows.map((r) => r.ageMinutes)), s)}
                  </span>
                </p>
              </div>
            </div>
          </Card>
          <ul className="grid gap-3 sm:gap-4">
            {rows.map((row) => (
              <li key={row.id}>
                <Card>
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="font-display font-semibold text-text-main">
                        {row.customerName ?? s.noName}{" "}
                        <span className="ml-1 font-normal text-text-muted">{row.customerPhoneMasked}</span>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-text-muted">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold ${ageChipClass(row.ageMinutes)}`}
                        >
                          {s.lastActivity} {ageLabel(row.ageMinutes, s)}
                        </span>
                        <span>
                          {row.address?.district ? row.address.district : s.districtMissing}
                          {row.address?.upazila ? `, ${row.address.upazila}` : ""}
                        </span>
                      </p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="tnum font-semibold">{formatBdt(row.subtotalPoisha)}</p>
                      <p className="tnum text-small text-text-muted">{interpolate(s.itemsCount, { n: row.itemCount })}</p>
                    </div>
                  </div>

                  <ul className="mt-3 divide-y divide-border/60 rounded-xl border border-border/60 bg-surface-2/40">
                    {row.items.map((item) => (
                      <li key={item.variantId} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5 text-small">
                        <span className="font-medium">{item.productName ?? s.productMissing}</span>
                        {item.sku && <span className="text-text-muted">{item.sku}</span>}
                        <span className="tnum ml-auto text-text-muted">
                          × {item.quantity} · {formatBdt(item.pricePoishaAtCapture)} {s.capturePriceSuffix}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      disabled={busyId === row.id || row.hasCallTask}
                      onClick={() => void act(row.id, "call-task")}
                      className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-1.5 text-small font-medium text-text-main transition duration-fast ease-smooth disabled:opacity-50 sm:min-h-0 sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      {row.hasCallTask ? s.callTaskExists : s.createCallTask}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void act(row.id, "convert")}
                      className="min-h-11 w-full rounded-xl bg-brand-600 px-3 py-1.5 text-small font-medium text-white transition duration-fast ease-smooth disabled:opacity-50 sm:min-h-0 sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      {s.convertBtn}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void act(row.id, "dismiss")}
                      className="min-h-11 w-full rounded-xl border border-danger/30 bg-surface px-3 py-1.5 text-small font-medium text-danger transition duration-fast ease-smooth disabled:opacity-50 sm:min-h-0 sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      {s.dismissBtn}
                    </button>
                    <Link
                      href="/admin/call-center"
                      className="self-center rounded text-small font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 sm:ml-auto"
                    >
                      {s.goCallCenter}
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
