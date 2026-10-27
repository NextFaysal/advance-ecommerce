"use client";

/**
 * Order editing panel — order detail page (doc 17, O6).
 *
 * Talks to /api/v1/admin/orders/[id]/edit (GET editable view, POST
 * apply). Line quantities are edited locally (steppers), lines can
 * be removed, and new lines are added via the same admin products
 * search the manual order builder uses — adds are priced by the
 * SERVER at the current catalog price, never by this panel.
 *
 * Saving shows the before → after totals the server returned. The
 * server recomputes shipping with the checkout engine and
 * re-evaluates any applied coupon, so the totals after a save can
 * move for more than the edited lines (e.g. a coupon dropping off) —
 * the result strip says so when the coupon was removed.
 *
 * When the order is past the editable states the panel renders the
 * server's explanation instead of the editor. Props are
 * serializable only (the order id); all data is fetched
 * client-side, so a 403 (no orders.edit) degrades to a quiet note.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPoisha } from "@/components/ui/money";
import { lineTotalPoisha } from "@/lib/quantity";
import { interpolate, pick, type Locale } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";

interface EditLine {
  orderItemId: string;
  variantId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  quantity: number;
}

interface Money {
  subtotalPoisha: number;
  discountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  totalPoisha: number;
}

interface EditView {
  orderId: string;
  orderNo: string;
  status: string;
  editable: boolean;
  notEditableReasonBn: string | null;
  lines: EditLine[];
  totals: Money;
}

interface EditOutcome {
  orderId: string;
  before: Money;
  after: Money;
  couponRemoved: boolean;
  couponCode: string | null;
}

interface VariantHit {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  pricePoisha: number;
  stock: number;
  isActive: boolean;
}

interface ProductHit {
  id: string;
  status: string;
  titleBn: string;
  variants: VariantHit[];
}

interface PendingAdd {
  variantId: string;
  label: string;
  sku: string;
  unitPricePoisha: number;
  stock: number;
  quantity: number;
}

const inputCls =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function variantLabel(attrs: Record<string, string>, locale: Locale): string {
  const parts = Object.values(attrs ?? {}).filter(Boolean);
  return parts.length > 0
    ? parts.join(" / ")
    : pick(locale, ORDER_STRINGS).variantDefault;
}

export function EditPanel({ orderId }: { orderId: string }) {
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [view, setView] = useState<EditView | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [adds, setAdds] = useState<PendingAdd[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<EditOutcome | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/edit`);
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { data?: EditView };
      if (json.data) {
        setView(json.data);
        setQty(Object.fromEntries(json.data.lines.map((l) => [l.orderItemId, l.quantity])));
        setRemoved(new Set());
        setAdds([]);
      } else {
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: q.trim(), status: "ALL", page: "1", pageSize: "10" });
      const res = await fetch(`/api/v1/admin/products?${params.toString()}`);
      const body = (await res.json().catch(() => null)) as {
        data?: Array<{ id: string; status: string; title: { bn: string }; variants: VariantHit[] }>;
      } | null;
      if (!res.ok) {
        setHits([]);
        return;
      }
      setHits(
        (body?.data ?? []).map((p) => ({
          id: p.id,
          status: p.status,
          titleBn: p.title.bn,
          variants: p.variants ?? [],
        })),
      );
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void runSearch(query), 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, runSearch]);

  if (forbidden) return null;
  if (loadFailed) {
    return (
      <Card className="p-4">
        <p className="text-small text-text-subtle">{s.edLoadFail}</p>
      </Card>
    );
  }
  if (!view) {
    return (
      <Card className="p-4">
        <p className="text-small text-text-subtle">{t.loading}</p>
      </Card>
    );
  }

  if (!view.editable) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-small font-semibold">{s.edTitle}</h3>
          <Badge tone="neutral">{view.status}</Badge>
        </div>
        <p className="mt-2 text-small text-text-subtle">
          {view.notEditableReasonBn ?? s.edNotEditableFallback}
        </p>
      </Card>
    );
  }

  const dirty =
    removed.size > 0 ||
    adds.length > 0 ||
    view.lines.some((l) => (qty[l.orderItemId] ?? l.quantity) !== l.quantity);

  const previewSubtotal =
    view.lines
      .filter((l) => !removed.has(l.orderItemId))
      .reduce((sum, l) => sum + lineTotalPoisha(l.unitPricePoisha, qty[l.orderItemId] ?? l.quantity), 0) +
    adds.reduce((sum, a) => sum + lineTotalPoisha(a.unitPricePoisha, a.quantity), 0);

  async function save() {
    if (!view) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const setQuantities = view.lines
        .filter((l) => !removed.has(l.orderItemId))
        .filter((l) => (qty[l.orderItemId] ?? l.quantity) !== l.quantity)
        .map((l) => ({ orderItemId: l.orderItemId, quantity: qty[l.orderItemId] ?? l.quantity }));
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          setQuantities,
          removeItemIds: [...removed],
          addItems: adds.map((a) => ({ variantId: a.variantId, quantity: a.quantity })),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: EditOutcome;
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? s.edSaveFail);
        return;
      }
      setOutcome(json.data);
      await load();
    } catch {
      setError(s.networkRetry);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-small font-semibold">{s.edTitle}</h3>
        <Badge tone="info">{view.status}</Badge>
        {dirty && <Badge tone="warning">{s.edUnsaved}</Badge>}
      </div>
      <p className="mt-1 text-caption text-text-subtle">{s.edIntro}</p>

      <ul className="mt-3 divide-y divide-border">
        {view.lines.map((l) => {
          const isRemoved = removed.has(l.orderItemId);
          const q = qty[l.orderItemId] ?? l.quantity;
          return (
            <li key={l.orderItemId} className={`py-2.5 ${isRemoved ? "opacity-50" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-small font-medium">{l.productName}</p>
                  <p className="text-caption text-text-subtle">
                    {interpolate(s.edLineMeta, { sku: l.sku, price: formatPoisha(l.unitPricePoisha) })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-8 px-0"
                    disabled={isRemoved || busy}
                    onClick={() =>
                      setQty((s) => ({ ...s, [l.orderItemId]: Math.max(1, q - 1) }))
                    }
                    aria-label={s.edQtyDown}
                  >
                    −
                  </Button>
                  <span className="w-8 text-center text-small font-semibold">{q}</span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-8 px-0"
                    disabled={isRemoved || busy}
                    onClick={() =>
                      setQty((s) => ({ ...s, [l.orderItemId]: Math.min(999, q + 1) }))
                    }
                    aria-label={s.edQtyUp}
                  >
                    +
                  </Button>
                </div>
                <span className="w-24 text-right text-small font-medium">
                  {formatPoisha(lineTotalPoisha(l.unitPricePoisha, q))}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-2 text-rose-600"
                  disabled={busy}
                  onClick={() =>
                    setRemoved((s) => {
                      const next = new Set(s);
                      if (next.has(l.orderItemId)) next.delete(l.orderItemId);
                      else next.add(l.orderItemId);
                      return next;
                    })
                  }
                >
                  {isRemoved ? s.edRestore : s.edRemove}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {adds.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-md border border-dashed border-border px-3">
          {adds.map((a) => (
            <li key={a.variantId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-small font-medium">{a.label}</p>
                <p className="text-caption text-text-subtle">
                  {interpolate(s.edAddMeta, { sku: a.sku, price: formatPoisha(a.unitPricePoisha), stock: a.stock })}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 w-8 px-0"
                  disabled={busy}
                  onClick={() =>
                    setAdds((s) =>
                      s.map((x) =>
                        x.variantId === a.variantId
                          ? { ...x, quantity: Math.max(1, x.quantity - 1) }
                          : x,
                      ),
                    )
                  }
                  aria-label={s.edQtyDown}
                >
                  −
                </Button>
                <span className="w-8 text-center text-small font-semibold">{a.quantity}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 w-8 px-0"
                  disabled={busy}
                  onClick={() =>
                    setAdds((s) =>
                      s.map((x) =>
                        x.variantId === a.variantId
                          ? { ...x, quantity: Math.min(999, x.quantity + 1) }
                          : x,
                      ),
                    )
                  }
                  aria-label={s.edQtyUp}
                >
                  +
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-2 text-rose-600"
                disabled={busy}
                onClick={() => setAdds((s) => s.filter((x) => x.variantId !== a.variantId))}
              >
                {s.edDrop}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <input
          className={inputCls}
          placeholder={s.edSearchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <p className="mt-1.5 text-caption text-text-subtle">{s.edSearching}</p>}
        {hits.length > 0 && (
          <ul className="mt-2 space-y-2">
            {hits.map((p) => (
              <li key={p.id} className="rounded-md border border-border px-3 py-2">
                <p className="text-small font-semibold">{p.titleBn}</p>
                <ul className="mt-1 divide-y divide-border">
                  {p.variants.map((v) => {
                    const already =
                      adds.some((a) => a.variantId === v.id) ||
                      view.lines.some(
                        (l) => l.variantId === v.id && !removed.has(l.orderItemId),
                      );
                    return (
                      <li
                        key={v.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-small"
                      >
                        <span className="font-medium">{variantLabel(v.attributes, locale)}</span>
                        <span className="text-text-subtle">{v.sku}</span>
                        <span>{formatPoisha(v.pricePoisha)}</span>
                        <span className="text-text-subtle">{interpolate(s.edStock, { n: v.stock })}</span>
                        <Button
                          type="button"
                          variant="outline"
                          className="ml-auto h-8 px-2.5"
                          disabled={busy || already || !v.isActive || v.stock <= 0}
                          onClick={() =>
                            setAdds((s) => [
                              ...s,
                              {
                                variantId: v.id,
                                label: `${p.titleBn} — ${variantLabel(v.attributes, locale)}`,
                                sku: v.sku,
                                unitPricePoisha: v.pricePoisha,
                                stock: v.stock,
                                quantity: 1,
                              },
                            ])
                          }
                        >
                          {already ? s.edAdded : s.edAdd}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <p className="text-small">
          {s.edSubtotalLabel} <span className="font-semibold">{formatPoisha(previewSubtotal)}</span>
          <span className="text-text-subtle"> {s.edSubtotalNote}</span>
        </p>
        <Button type="button" className="ml-auto" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? t.saving : s.edSaveBtn}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">{error}</p>
      )}
      {outcome && (
        <div role="status" className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-small text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          <p>
            {interpolate(s.edSaved, {
              bTotal: formatPoisha(outcome.before.totalPoisha),
              aTotal: formatPoisha(outcome.after.totalPoisha),
              bSub: formatPoisha(outcome.before.subtotalPoisha),
              aSub: formatPoisha(outcome.after.subtotalPoisha),
              bShip: formatPoisha(outcome.before.shippingPoisha),
              aShip: formatPoisha(outcome.after.shippingPoisha),
            })}
          </p>
          {outcome.couponRemoved && (
            <p className="mt-1 font-medium">
              {interpolate(s.edCouponRemoved, { code: outcome.couponCode ?? "" })}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
