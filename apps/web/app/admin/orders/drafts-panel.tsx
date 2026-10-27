"use client";

/**
 * Draft orders strip (doc 17, batch O9-2) — the OPEN drafts parked
 * from the manual builder, listed above it on the orders page.
 * Self-fetching (GET /api/v1/admin/orders/drafts); renders nothing
 * when there are no OPEN drafts, so the page stays clean for shops
 * that never park an order.
 *
 * Actions:
 *   Resume   — navigates to /admin/orders?draft=<id> (full page load)
 *              where the builder loads the payload back into its form;
 *              submitting there converts THIS draft.
 *   Convert  — POST .../drafts/[id]/convert straight from the strip;
 *              the stored payload is re-validated + re-priced by
 *              createManualOrder at conversion (see src/orders/drafts).
 *   Discard  — DELETE (OPEN -> DISCARDED; the row is kept for audit).
 *
 * A draft is NOT an order: no order number, no stock reserved — the
 * strip copy says so, because a preview total here is an estimate,
 * refreshed at save, never a priced commitment.
 */
import { useCallback, useEffect, useState } from "react";
import { formatBdt } from "../../../src/checkout/pricing";
import { interpolate, intlLocale, pick } from "../../../src/i18n/locale";
import { useLocale } from "../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "./strings";
import { orderAgeLabel } from "./list-helpers";

interface DraftSummary {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  totalPreviewPoisha: number | null;
  itemCount: number;
  status: string;
  updatedAt: string;
}

export function DraftsPanel({ onConverted }: { onConverted?: () => void | Promise<void> }) {
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/orders/drafts");
      const body = (await res.json().catch(() => null)) as { data?: DraftSummary[] } | null;
      if (res.ok && Array.isArray(body?.data)) {
        setDrafts(body.data.filter((d) => d.status === "OPEN"));
      } else {
        setDrafts([]);
      }
    } catch {
      setDrafts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function convert(id: string) {
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/admin/orders/drafts/${id}/convert`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        data?: { orderNo?: string };
        meta?: { convertedReplay?: boolean };
        error?: { code: string; message: string };
      } | null;
      if (res.ok && body?.data?.orderNo) {
        setMsg({
          ok: true,
          text: body.meta?.convertedReplay
            ? interpolate(s.draftConvertedReplay, { orderNo: body.data.orderNo })
            : interpolate(s.draftConverted, { orderNo: body.data.orderNo }),
        });
        await load();
        await onConverted?.();
      } else {
        setMsg({
          ok: false,
          text: body?.error
            ? `${body.error.code}: ${body.error.message}`
            : interpolate(s.draftConvertHttp, { status: res.status }),
        });
      }
    } catch {
      setMsg({ ok: false, text: s.draftConvertNet });
    } finally {
      setBusyId(null);
    }
  }

  async function discard(id: string) {
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/admin/orders/drafts/${id}`, { method: "DELETE" });
      if (res.ok) {
        setMsg({ ok: true, text: s.draftDiscarded });
        await load();
      } else {
        const body = (await res.json().catch(() => null)) as {
          error?: { code: string; message: string };
        } | null;
        setMsg({
          ok: false,
          text: body?.error
            ? `${body.error.code}: ${body.error.message}`
            : interpolate(s.draftDiscardHttp, { status: res.status }),
        });
      }
    } catch {
      setMsg({ ok: false, text: s.draftDiscardNet });
    } finally {
      setBusyId(null);
    }
  }

  if (!drafts || drafts.length === 0) return null;

  return (
    <section aria-label={s.draftsAria} className="mt-8 rounded-lg border border-amber-200 bg-amber-50/60 p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h3">
          {interpolate(s.draftsTitle, { n: drafts.length.toLocaleString(intlLocale(locale)) })}
        </h2>
        <p className="text-caption text-text-muted">{s.draftsNote}</p>
      </div>
      <ul className="mt-3 divide-y divide-amber-200/70">
        {drafts.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 text-small">
            <span className="font-semibold">{d.customerName ?? s.draftNoName}</span>
            {d.customerPhone && <span className="font-mono text-text-muted">{d.customerPhone}</span>}
            <span className="text-text-muted">
              {interpolate(s.draftItems, { n: d.itemCount.toLocaleString(intlLocale(locale)) })}
            </span>
            <span className="font-mono font-semibold tabular-nums">
              {d.totalPreviewPoisha !== null ? formatBdt(d.totalPreviewPoisha) : s.draftNoPrice}
            </span>
            <span className="text-caption text-text-subtle">{orderAgeLabel(d.updatedAt, Date.now(), locale)}</span>
            <span className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busyId === d.id}
                onClick={() => window.location.assign(`/admin/orders?draft=${d.id}`)}
                className="min-h-[36px] rounded-md border border-border bg-card px-3 font-semibold transition motion-fast hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                {s.draftResume}
              </button>
              <button
                type="button"
                disabled={busyId === d.id}
                onClick={() => void convert(d.id)}
                className="min-h-[36px] rounded-md bg-brand-600 px-3 font-semibold text-white transition motion-fast hover:bg-brand-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                {busyId === d.id ? s.draftBusy : s.draftConvert}
              </button>
              <button
                type="button"
                disabled={busyId === d.id}
                onClick={() => void discard(d.id)}
                className="min-h-[36px] rounded-md border border-border bg-card px-3 font-semibold text-rose-600 transition motion-fast hover:bg-rose-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                {t.cancel}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {msg && (
        <p
          role="status"
          className={`mt-3 rounded-md px-3.5 py-2.5 text-small leading-relaxed ${
            msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"
          }`}
        >
          {msg.text}
        </p>
      )}
    </section>
  );
}
