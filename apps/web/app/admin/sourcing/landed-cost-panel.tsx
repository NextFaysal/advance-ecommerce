"use client";

// Landed-cost calculator panel — Wave 15-3 (doc 16 §P7).
// Math lives in src/sourcing/landed.ts (integer poisha, round-half-up
// per step, margin = on-cost). This panel is the form + results, plus
// the "set as variant cost" action: it loads a product through the
// admin API, resends the FULL variant list with only the chosen
// variant's costPoisha changed (PATCH replaces variants by SKU —
// sending a partial list would soft-delete the rest), and always
// attaches a reason, per the PATCH contract for price/cost changes.
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { formatPoisha } from "@/components/ui/money";
import { computeLandedCost, poishaToTakaInput, type LandedResult } from "@/sourcing/landed";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SOURCING_STRINGS } from "./strings";

const inputCls =
  "min-h-[44px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";
const labelCls = "mb-1.5 block text-xs font-semibold text-text-muted";

interface VariantView {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  barcode: string | null;
  pricePoisha: number;
  compareAtPoisha: number | null;
  costPoisha: number | null;
  stock: number;
  imageUrl: string | null;
  isActive: boolean;
}

interface ProductView {
  id: string;
  slug: string;
  titleBn: string;
  variants: VariantView[];
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

function variantLabel(v: VariantView): string {
  const attrs = Object.values(v.attributes ?? {}).filter(Boolean).join(" / ");
  return attrs ? `${v.sku} (${attrs})` : v.sku;
}

export function LandedCostPanel() {
  const { locale } = useLocale();
  const s = pick(locale, SOURCING_STRINGS);
  // Calculator inputs (decimal strings — parsed by exact string math).
  const [currency, setCurrency] = useState("USD");
  const [unitPrice, setUnitPrice] = useState("");
  const [rate, setRate] = useState("");
  const [quantity, setQuantity] = useState("100");
  const [shipping, setShipping] = useState("");
  const [duty, setDuty] = useState("");
  const [localTransport, setLocalTransport] = useState("");
  const [result, setResult] = useState<LandedResult | null>(null);

  // Apply-to-variant state.
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ProductView[]>([]);
  const [product, setProduct] = useState<ProductView | null>(null);
  const [variantId, setVariantId] = useState<string>("");
  const [reason, setReason] = useState(s.defaultReason);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const calculate = () => {
    setResult(
      computeLandedCost({
        unitPriceForeign: unitPrice,
        rateTaka: rate,
        quantity: Number(quantity),
        shippingForeign: shipping,
        dutyPercent: duty,
        localTransportTaka: localTransport,
      }),
    );
  };

  const searchProducts = async () => {
    setApplyError(null);
    setApplyMsg(null);
    setSearching(true);
    try {
      const res = await fetch(`/api/v1/admin/products?q=${encodeURIComponent(query)}&pageSize=20&status=ALL`);
      if (!res.ok) throw new Error(await readError(res, s.searchFailed));
      const body = (await res.json()) as { data: ProductView[] };
      setResults(body.data);
      setProduct(null);
      setVariantId("");
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : s.searchFailed);
    } finally {
      setSearching(false);
    }
  };

  const loadProduct = async (id: string) => {
    setApplyError(null);
    try {
      const res = await fetch(`/api/v1/admin/products/${id}`);
      if (!res.ok) throw new Error(await readError(res, s.detailsFailed));
      const body = (await res.json()) as { data: ProductView };
      // Normalize: a cost the API withheld arrives as undefined —
      // coerce to null so the PATCH below always sends an explicit value.
      const normalized: ProductView = {
        ...body.data,
        variants: body.data.variants.map((v) => ({
          ...v,
          barcode: v.barcode ?? null,
          compareAtPoisha: v.compareAtPoisha ?? null,
          costPoisha: v.costPoisha ?? null,
          imageUrl: v.imageUrl ?? null,
          attributes: v.attributes ?? {},
        })),
      };
      setProduct(normalized);
      setVariantId(normalized.variants[0]?.id ?? "");
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : s.detailsFailed);
    }
  };

  const applyCost = async () => {
    setApplyError(null);
    setApplyMsg(null);
    if (!result?.ok || !product) return;
    const target = product.variants.find((v) => v.id === variantId);
    if (!target) {
      setApplyError(s.chooseVariant);
      return;
    }
    if (reason.trim() === "") {
      setApplyError(s.reasonRequired);
      return;
    }
    setApplying(true);
    try {
      const variants = product.variants.map((v) => ({
        attributes: v.attributes,
        sku: v.sku,
        barcode: v.barcode,
        pricePoisha: v.pricePoisha,
        compareAtPoisha: v.compareAtPoisha,
        costPoisha: v.id === variantId ? result.breakdown.landedPoishaPerUnit : v.costPoisha,
        stock: v.stock,
        imageUrl: v.imageUrl,
        isActive: v.isActive,
      }));
      const res = await fetch(`/api/v1/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variants, reason: reason.trim() }),
      });
      if (!res.ok) throw new Error(await readError(res, s.applyFailed));
      setApplyMsg(
        interpolate(s.appliedMsg, { label: variantLabel(target), landed: formatPoisha(result.breakdown.landedPoishaPerUnit), prev: target.costPoisha !== null ? formatPoisha(target.costPoisha) : "—" }),
      );
      await loadProduct(product.id);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : s.applyFailed);
    } finally {
      setApplying(false);
    }
  };

  const breakdown = result?.ok ? result.breakdown : null;

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="bg-brand-soft flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-brand-ink shadow-md">
            <Icon name="banknote" size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-text-main">{s.worksheetTitle}</h2>
            <p className="text-xs text-text-subtle">{s.worksheetSub}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="lc-currency">
              {s.currency}
            </label>
            <select id="lc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
              <option value="USD">{s.curUsd}</option>
              <option value="CNY">{s.curCny}</option>
              <option value="EUR">{s.curEur}</option>
              <option value="INR">{s.curInr}</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-unit">
              {interpolate(s.unitPrice, { currency })}
            </label>
            <input id="lc-unit" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="12.50" inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-rate">
              {interpolate(s.rateLabel, { currency })}
            </label>
            <input id="lc-rate" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="119.75" inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-qty">
              {s.totalPieces}
            </label>
            <input id="lc-qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-ship">
              {interpolate(s.intlShipping, { currency })}
            </label>
            <input id="lc-ship" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="180" inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-duty">
              {s.duty}
            </label>
            <input id="lc-duty" value={duty} onChange={(e) => setDuty(e.target.value)} placeholder="25" inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-local">
              {s.localTransport}
            </label>
            <input id="lc-local" value={localTransport} onChange={(e) => setLocalTransport(e.target.value)} placeholder="3000" inputMode="decimal" className={inputCls} />
          </div>
        </div>
        <button
          type="button"
          onClick={calculate}
          className="brand-gradient inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105 max-sm:w-full"
        >
          <Icon name="chart" size={16} />
          {s.calculate}
        </button>
        {result && !result.ok ? (
          <div role="alert" className="anim-pop-in flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-800">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
              <Icon name="alert" size={16} />
            </span>
            <p className="leading-relaxed">{result.messageBn}</p>
          </div>
        ) : null}
        <p className="flex gap-2 text-xs leading-relaxed text-text-subtle">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          <span>
            {s.calcRule}
          </span>
        </p>
      </Card>

      {breakdown && result?.ok ? (
        <>
          <Card>
            <h2 className="font-display text-base font-semibold text-text-main">{s.breakdownTitle}</h2>
            <dl className="mt-3 grid gap-2.5 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-inset ring-border/60">
                <dt className="text-xs font-medium text-text-muted">{s.bdGoods}</dt>
                <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-text-main">{formatPoisha(breakdown.goodsPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-inset ring-border/60">
                <dt className="text-xs font-medium text-text-muted">{s.bdShipping}</dt>
                <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-text-main">{formatPoisha(breakdown.shippingPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-inset ring-border/60">
                <dt className="text-xs font-medium text-text-muted">{s.bdDuty}</dt>
                <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-text-main">{formatPoisha(breakdown.dutyPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-inset ring-border/60">
                <dt className="text-xs font-medium text-text-muted">{s.bdLocal}</dt>
                <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-text-main">{formatPoisha(breakdown.localPoishaPerUnit)}</dd>
              </div>
              <div className="bg-brand-600 rounded-xl px-4 py-3.5 text-white shadow-md sm:col-span-2">
                <dt className="text-xs font-medium text-white/85">{s.bdLanded}</dt>
                <dd className="mt-1 font-mono text-2xl font-bold tabular-nums">{formatPoisha(breakdown.landedPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-3 sm:col-span-2">
                <dt className="text-xs font-medium text-text-muted">{s.bdTotal}</dt>
                <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-brand-800">{formatPoisha(breakdown.landedPoishaTotal)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="font-display text-base font-semibold text-text-main">{s.marginTitle}</h2>
            <div className="mt-3 overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="bg-surface-2/80 text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold text-text-muted">{s.colMargin}</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-text-muted">{s.colSellPrice}</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-text-muted">{s.colProfit}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.margins.map((row) => (
                    <tr key={row.marginPercent} className="border-t border-border/60 transition motion-fast hover:bg-brand-50/50">
                      <td className="px-4 py-2.5">
                        <span className="inline-flex h-6 items-center rounded-full bg-brand-50 px-2.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                          {row.marginPercent}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono font-medium tabular-nums">{formatPoisha(row.sellPoisha)}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-emerald-700">{formatPoisha(row.profitPoisha)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                <Icon name="package" size={20} />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-text-main">{s.applyTitle}</h2>
                <p className="text-xs text-text-subtle">{s.applySub}</p>
              </div>
            </div>
            <p className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed text-text-muted">
              {interpolate(s.applyNote, { landed: formatPoisha(breakdown.landedPoishaPerUnit), taka: poishaToTakaInput(breakdown.landedPoishaPerUnit) })}
            </p>
            <div className="flex flex-col gap-2 min-[560px]:flex-row">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={s.searchPlaceholder}
                className={`${inputCls} flex-1`}
              />
              <button
                type="button"
                onClick={searchProducts}
                disabled={searching}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-5 py-2 text-sm font-semibold shadow-sm transition motion-fast hover:bg-surface-2 hover:shadow-card disabled:opacity-50"
              >
                <Icon name="search" size={16} />
                {searching ? s.searching : s.search}
              </button>
            </div>
            {results.length > 0 ? (
              <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => loadProduct(p.id)}
                      className={`flex min-h-[44px] w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm transition motion-fast hover:bg-surface-2 ${
                        product?.id === p.id ? "bg-brand-50 font-medium" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {p.titleBn} <span className="font-mono text-xs text-text-subtle">{p.slug}</span>
                      </span>
                      <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-surface-2 px-2.5 text-xs text-text-muted ring-1 ring-inset ring-black/5">
                        {interpolate(s.variantsCount, { count: p.variants.length })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {product ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor="lc-variant">
                    {s.variant}
                  </label>
                  <select id="lc-variant" value={variantId} onChange={(e) => setVariantId(e.target.value)} className={inputCls}>
                    {product.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {variantLabel(v)} — {interpolate(s.currentCost, { cost: v.costPoisha !== null ? formatPoisha(v.costPoisha) : s.costNotSet })}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="lc-reason">
                    {s.reasonLabel}
                  </label>
                  <input id="lc-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
                </div>
              </div>
            ) : null}
            {applyError ? (
              <div role="alert" className="anim-pop-in flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-800">
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                  <Icon name="alert" size={16} />
                </span>
                <p className="leading-relaxed">{applyError}</p>
              </div>
            ) : null}
            {applyMsg ? (
              <div role="status" className="anim-pop-in flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-900">
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Icon name="check" size={16} />
                </span>
                <p className="leading-relaxed">{applyMsg}</p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={applyCost}
              disabled={applying || !product || variantId === ""}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition motion-fast hover:bg-emerald-700 hover:shadow-lift disabled:opacity-50 max-sm:w-full"
            >
              <Icon name="check" size={16} />
              {applying ? s.applying : s.applyBtn}
            </button>
          </Card>
        </>
      ) : null}
    </div>
  );
}
