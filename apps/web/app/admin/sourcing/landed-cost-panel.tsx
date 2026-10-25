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
import { formatPoisha } from "@/components/ui/money";
import { computeLandedCost, poishaToTakaInput, type LandedResult } from "@/sourcing/landed";

const inputCls =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1 block text-xs font-medium text-text-muted";

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
      <Card className="space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-3">
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
          className="min-h-[44px] rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          হিসাব করুন
        </button>
        {result && !result.ok ? (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {result.messageBn}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-text-subtle">
          হিসাবের নিয়ম: পণ্যের দাম + আন্তর্জাতিক শিপিং (CIF) এর উপর শুল্ক, তারপর স্থানীয় পরিবহন ভাগ হয় প্রতি পিসে।
          সব হিসাব পূর্ণ পয়সায় (প্রতি ধাপে হাফ-আপ রাউন্ড) — মার্জিন মানে খরচের উপর শতকরা লাভ।
        </p>
      </Card>

      {breakdown && result?.ok ? (
        <>
          <Card className="p-4">
            <h2 className="font-display text-base font-semibold">প্রতি পিসের খরচের ভাঙন</h2>
            <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 md:grid-cols-3">
              <div className="rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-text-muted">পণ্যের দাম</dt>
                <dd className="font-mono font-medium">{formatPoisha(breakdown.goodsPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-text-muted">আন্তর্জাতিক শিপিং (প্রতি পিস)</dt>
                <dd className="font-mono font-medium">{formatPoisha(breakdown.shippingPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-text-muted">শুল্ক (প্রতি পিস)</dt>
                <dd className="font-mono font-medium">{formatPoisha(breakdown.dutyPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-text-muted">স্থানীয় পরিবহন (প্রতি পিস)</dt>
                <dd className="font-mono font-medium">{formatPoisha(breakdown.localPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-lg bg-brand-50 px-3 py-2">
                <dt className="text-text-muted">মোট ল্যান্ডেড খরচ (প্রতি পিস)</dt>
                <dd className="font-mono text-base font-bold">{formatPoisha(breakdown.landedPoishaPerUnit)}</dd>
              </div>
              <div className="rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-text-muted">পুরো শিপমেন্টের ল্যান্ডেড খরচ</dt>
                <dd className="font-mono font-medium">{formatPoisha(breakdown.landedPoishaTotal)}</dd>
              </div>
            </dl>
          </Card>

          <Card className="p-4">
            <h2 className="font-display text-base font-semibold">মার্জিন অনুযায়ী বিক্রয়মূল্যের পরামর্শ</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted">
                    <th className="py-1 pr-3 font-medium">মার্জিন (খরচের উপর)</th>
                    <th className="py-1 pr-3 font-medium">বিক্রয়মূল্য</th>
                    <th className="py-1 font-medium">লাভ / পিস</th>
                  </tr>
                </thead>
                <tbody>
                  {result.margins.map((row) => (
                    <tr key={row.marginPercent} className="border-t border-border">
                      <td className="py-1.5 pr-3">{row.marginPercent}%</td>
                      <td className="py-1.5 pr-3 font-mono">{formatPoisha(row.sellPoisha)}</td>
                      <td className="py-1.5 font-mono">{formatPoisha(row.profitPoisha)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="font-display text-base font-semibold">কোনো ভ্যারিয়েন্টে এই খরচ বসান</h2>
            <p className="text-sm text-text-subtle">
              ল্যান্ডেড খরচ {formatPoisha(breakdown.landedPoishaPerUnit)} (= {poishaToTakaInput(breakdown.landedPoishaPerUnit)} টাকা)
              বেছে নেওয়া ভ্যারিয়েন্টের ক্রয়মূল্য (cost) হিসেবে বসবে। বিক্রয়মূল্য বদলাবে না।
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="পণ্যের নাম বা SKU দিয়ে খুঁজুন"
                className={`${inputCls} min-w-56 flex-1`}
              />
              <button
                type="button"
                onClick={searchProducts}
                disabled={searching}
                className="min-h-[44px] rounded-md border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-surface-2 disabled:opacity-50"
              >
                {searching ? "খোঁজা হচ্ছে…" : "খুঁজুন"}
              </button>
            </div>
            {results.length > 0 ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => loadProduct(p.id)}
                      className={`w-full px-3 py-2 text-left text-sm transition hover:bg-surface-2 ${product?.id === p.id ? "bg-brand-50" : ""}`}
                    >
                      {p.titleBn} <span className="font-mono text-xs text-text-subtle">{p.slug}</span> · {p.variants.length}টি ভ্যারিয়েন্ট
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
              <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                {applyError}
              </p>
            ) : null}
            {applyMsg ? (
              <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {applyMsg}
              </p>
            ) : null}
            <button
              type="button"
              onClick={applyCost}
              disabled={applying || !product || variantId === ""}
              className="min-h-[44px] rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {applying ? "বসানো হচ্ছে…" : "ভ্যারিয়েন্টে খরচ বসান"}
            </button>
          </Card>
        </>
      ) : null}
    </div>
  );
}
