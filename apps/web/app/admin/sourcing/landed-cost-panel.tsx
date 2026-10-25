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
  const [reason, setReason] = useState("ল্যান্ডেড কস্ট ক্যালকুলেটর থেকে খরচ হালনাগাদ");
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
      if (!res.ok) throw new Error(await readError(res, "পণ্য খোঁজা যায়নি।"));
      const body = (await res.json()) as { data: ProductView[] };
      setResults(body.data);
      setProduct(null);
      setVariantId("");
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "পণ্য খোঁজা যায়নি।");
    } finally {
      setSearching(false);
    }
  };

  const loadProduct = async (id: string) => {
    setApplyError(null);
    try {
      const res = await fetch(`/api/v1/admin/products/${id}`);
      if (!res.ok) throw new Error(await readError(res, "পণ্যের বিবরণ আনা যায়নি।"));
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
      setApplyError(e instanceof Error ? e.message : "পণ্যের বিবরণ আনা যায়নি।");
    }
  };

  const applyCost = async () => {
    setApplyError(null);
    setApplyMsg(null);
    if (!result?.ok || !product) return;
    const target = product.variants.find((v) => v.id === variantId);
    if (!target) {
      setApplyError("একটি ভ্যারিয়েন্ট বেছে নিন।");
      return;
    }
    if (reason.trim() === "") {
      setApplyError("কারণ লিখুন — দাম/খরচ বদলের জন্য অডিটে কারণ লাগে।");
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
      if (!res.ok) throw new Error(await readError(res, "খরচ বসানো যায়নি।"));
      setApplyMsg(
        `✅ ${variantLabel(target)}-এর খরচ বসানো হয়েছে: ${formatPoisha(result.breakdown.landedPoishaPerUnit)} (আগে ছিল ${
          target.costPoisha !== null ? formatPoisha(target.costPoisha) : "—"
        })`,
      );
      await loadProduct(product.id);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "খরচ বসানো যায়নি।");
    } finally {
      setApplying(false);
    }
  };

  const breakdown = result?.ok ? result.breakdown : null;

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="banknote" size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-text-main">খরচের ওয়ার্কশিট</h2>
            <p className="text-xs text-text-subtle">ধাপ ১ — বিদেশি দাম, রেট, শিপিং ও শুল্ক দিন, প্রতি পিসের ল্যান্ডেড খরচ বেরিয়ে আসবে</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="lc-currency">
              মুদ্রা
            </label>
            <select id="lc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
              <option value="USD">USD (ডলার)</option>
              <option value="CNY">CNY (ইউয়ান)</option>
              <option value="EUR">EUR (ইউরো)</option>
              <option value="INR">INR (রুপি)</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-unit">
              প্রতি পিসের দাম ({currency}) *
            </label>
            <input id="lc-unit" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="12.50" inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-rate">
              আজকের রেট (১ {currency} = কত ৳) *
            </label>
            <input id="lc-rate" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="119.75" inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-qty">
              মোট পিস *
            </label>
            <input id="lc-qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-ship">
              আন্তর্জাতিক শিপিং, মোট ({currency})
            </label>
            <input id="lc-ship" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="180" inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-duty">
              কাস্টমস শুল্ক %
            </label>
            <input id="lc-duty" value={duty} onChange={(e) => setDuty(e.target.value)} placeholder="25" inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="lc-local">
              স্থানীয় পরিবহন, মোট (৳)
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
          হিসাব করুন
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
            হিসাবের নিয়ম: পণ্যের দাম + আন্তর্জাতিক শিপিং (CIF) এর উপর শুল্ক, তারপর স্থানীয় পরিবহন ভাগ হয় প্রতি পিসে।
            সব হিসাব পূর্ণ পয়সায় (প্রতি ধাপে হাফ-আপ রাউন্ড) — মার্জিন মানে খরচের উপর শতকরা লাভ।
          </span>
        </p>
      </Card>

      {breakdown && result?.ok ? (
        <>
          <Card>
            <h2 className="font-display text-base font-semibold text-text-main">প্রতি পিসের খরচের ভাঙন</h2>
            <dl className="mt-3 grid gap-2.5 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-inset ring-border/60">
                <dt className="text-xs font-medium text-text-muted">পণ্যের দাম</dt>
                <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-text-main">{formatPoisha(breakdown.goodsPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-inset ring-border/60">
                <dt className="text-xs font-medium text-text-muted">আন্তর্জাতিক শিপিং (প্রতি পিস)</dt>
                <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-text-main">{formatPoisha(breakdown.shippingPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-inset ring-border/60">
                <dt className="text-xs font-medium text-text-muted">শুল্ক (প্রতি পিস)</dt>
                <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-text-main">{formatPoisha(breakdown.dutyPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-inset ring-border/60">
                <dt className="text-xs font-medium text-text-muted">স্থানীয় পরিবহন (প্রতি পিস)</dt>
                <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-text-main">{formatPoisha(breakdown.localPoishaPerUnit)}</dd>
              </div>
              <div className="brand-gradient rounded-xl px-4 py-3.5 text-white shadow-md sm:col-span-2">
                <dt className="text-xs font-medium text-white/85">মোট ল্যান্ডেড খরচ (প্রতি পিস)</dt>
                <dd className="mt-1 font-mono text-2xl font-bold tabular-nums">{formatPoisha(breakdown.landedPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-3 sm:col-span-2">
                <dt className="text-xs font-medium text-text-muted">পুরো শিপমেন্টের ল্যান্ডেড খরচ</dt>
                <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-brand-800">{formatPoisha(breakdown.landedPoishaTotal)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="font-display text-base font-semibold text-text-main">মার্জিন অনুযায়ী বিক্রয়মূল্যের পরামর্শ</h2>
            <div className="mt-3 overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="bg-surface-2/80 text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold text-text-muted">মার্জিন (খরচের উপর)</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-text-muted">বিক্রয়মূল্য</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-text-muted">লাভ / পিস</th>
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
                <h2 className="font-display text-base font-semibold text-text-main">কোনো ভ্যারিয়েন্টে এই খরচ বসান</h2>
                <p className="text-xs text-text-subtle">ধাপ ২ — পণ্য খুঁজে ভ্যারিয়েন্ট বেছে নিন</p>
              </div>
            </div>
            <p className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed text-text-muted">
              ল্যান্ডেড খরচ <strong className="font-mono text-text-main">{formatPoisha(breakdown.landedPoishaPerUnit)}</strong> (= {poishaToTakaInput(breakdown.landedPoishaPerUnit)} টাকা)
              বেছে নেওয়া ভ্যারিয়েন্টের ক্রয়মূল্য (cost) হিসেবে বসবে। বিক্রয়মূল্য বদলাবে না।
            </p>
            <div className="flex flex-col gap-2 min-[560px]:flex-row">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="পণ্যের নাম বা SKU দিয়ে খুঁজুন"
                className={`${inputCls} flex-1`}
              />
              <button
                type="button"
                onClick={searchProducts}
                disabled={searching}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-5 py-2 text-sm font-semibold shadow-sm transition motion-fast hover:bg-surface-2 hover:shadow-card disabled:opacity-50"
              >
                <Icon name="search" size={16} />
                {searching ? "খোঁজা হচ্ছে…" : "খুঁজুন"}
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
                        {p.variants.length}টি ভ্যারিয়েন্ট
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
                    ভ্যারিয়েন্ট
                  </label>
                  <select id="lc-variant" value={variantId} onChange={(e) => setVariantId(e.target.value)} className={inputCls}>
                    {product.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {variantLabel(v)} — বর্তমান খরচ: {v.costPoisha !== null ? formatPoisha(v.costPoisha) : "বসানো নেই"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="lc-reason">
                    কারণ (অডিট লগে থাকবে) *
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
              {applying ? "বসানো হচ্ছে…" : "ভ্যারিয়েন্টে খরচ বসান"}
            </button>
          </Card>
        </>
      ) : null}
    </div>
  );
}
