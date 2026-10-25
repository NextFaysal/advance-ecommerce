"use client";

// Barcode label panel — Wave 15-3 (doc 16 §P7).
// Search via the admin products list API, tick variants (ONLY ones
// with a barcode — the rest are shown disabled with the reason),
// choose copies per variant + what prints on the label (price, shop
// name), and print. Barcodes are genuine CODE128 symbols rendered by
// JsBarcode into SVG; a value JsBarcode rejects falls back to the
// code printed as text with a note — a label is never decorated with
// fake bars. Print CSS isolates #barcode-label-sheet.
import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { formatPoisha } from "@/components/ui/money";

const inputCls =
  "min-h-[44px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";
const labelCls = "mb-1.5 block text-xs font-semibold text-text-muted";

interface VariantView {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  barcode: string | null;
  pricePoisha: number;
  isActive: boolean;
}

interface ProductView {
  id: string;
  slug: string;
  titleBn: string;
  variants: VariantView[];
}

interface Selection {
  product: ProductView;
  variant: VariantView;
  copies: number;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

function attrsText(v: VariantView): string {
  return Object.entries(v.attributes ?? {})
    .map(([k, val]) => `${k}: ${val}`)
    .join(" · ");
}

function BarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height: 42,
        width: 1.7,
        background: "transparent",
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [value]);
  if (failed) {
    return <p className="text-center font-mono text-[10px] leading-tight">{value} (বারকোড আঁকা যায়নি)</p>;
  }
  return <svg ref={ref} className="h-[42px] w-full" role="img" aria-label={`বারকোড ${value}`} />;
}

export function LabelsPanel() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductView[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Map<string, Selection>>(new Map());
  const [showPrice, setShowPrice] = useState(true);
  const [showShopName, setShowShopName] = useState(false);
  const [shopName, setShopName] = useState("");

  const search = async () => {
    setError(null);
    setSearching(true);
    try {
      const res = await fetch(`/api/v1/admin/products?q=${encodeURIComponent(query)}&pageSize=50&status=ALL`);
      if (!res.ok) throw new Error(await readError(res, "পণ্য খোঁজা যায়নি।"));
      const body = (await res.json()) as { data: ProductView[] };
      setProducts(body.data);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "পণ্য খোঁজা যায়নি।");
    } finally {
      setSearching(false);
    }
  };

  const toggle = (product: ProductView, variant: VariantView) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(variant.id)) next.delete(variant.id);
      else next.set(variant.id, { product, variant, copies: 1 });
      return next;
    });
  };

  const setCopies = (variantId: string, copies: number) => {
    setSelected((prev) => {
      const cur = prev.get(variantId);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(variantId, { ...cur, copies: Math.max(1, Math.min(500, Math.floor(copies) || 1)) });
      return next;
    });
  };

  const selections = [...selected.values()];
  const totalLabels = selections.reduce((sum, s) => sum + s.copies, 0);
  const sheetLabels: Selection[] = selections.flatMap((s) => Array.from({ length: s.copies }, () => s));

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start lg:gap-5 lg:space-y-0">
      {/* Print isolation: only the sheet is visible on paper. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #barcode-label-sheet, #barcode-label-sheet * { visibility: visible !important; }
          #barcode-label-sheet { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 !important; border: none !important; background: #fff !important; }
          @page { margin: 8mm; }
        }
      `}</style>

      <div className="space-y-4 lg:sticky lg:top-4">
      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="tag" size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-text-main">ভ্যারিয়েন্ট বাছাই করুন</h2>
            <p className="text-xs text-text-subtle">বারকোডওয়ালা ভ্যারিয়েন্টে টিক দিন, কপি ঠিক করুন</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 min-[420px]:flex-row lg:flex-col min-[1100px]:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
            placeholder="পণ্যের নাম বা SKU দিয়ে খুঁজুন (খালি রাখলে সাম্প্রতিক ৫০টি)"
            className={`${inputCls} flex-1`}
          />
          <button
            type="button"
            onClick={search}
            disabled={searching}
            className="brand-gradient inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105 disabled:opacity-50"
          >
            <Icon name="search" size={16} />
            {searching ? "খোঁজা হচ্ছে…" : "খুঁজুন"}
          </button>
        </div>
        <p className="flex gap-2 text-xs leading-relaxed text-text-subtle">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          <span>
            শুধু যেসব ভ্যারিয়েন্টে বারকোড আছে সেগুলোরই লেবেল হয় — বারকোড ছাড়া ভ্যারিয়েন্ট নিষ্ক্রিয় দেখাবে;
            আগে পণ্য এডিটরে গিয়ে বারকোড বসান।
          </span>
        </p>
        {error ? (
          <div role="alert" className="anim-pop-in flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-800">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
              <Icon name="alert" size={16} />
            </span>
            <p className="leading-relaxed">{error}</p>
          </div>
        ) : null}
        {searched && products.length === 0 ? <p className="text-sm text-text-subtle">কোনো পণ্য মেলেনি।</p> : null}
        {products.length > 0 ? (
          <div className="space-y-3">
            {products.map((p) => (
              <div key={p.id} className="overflow-hidden rounded-xl border border-border/70">
                <p className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-surface-2/80 px-3.5 py-2.5 text-sm font-medium text-text-main">
                  <span className="min-w-0 flex-1 truncate">
                    {p.titleBn} <span className="font-mono text-xs font-normal text-text-subtle">{p.slug}</span>
                  </span>
                  <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-card px-2.5 text-xs text-text-muted ring-1 ring-inset ring-black/5">
                    {p.variants.length}টি ভ্যারিয়েন্ট
                  </span>
                </p>
                <ul className="divide-y divide-border/60">
                  {p.variants.map((v) => {
                    const hasBarcode = typeof v.barcode === "string" && v.barcode.trim() !== "";
                    const isPicked = selected.has(v.id);
                    return (
                      <li
                        key={v.id}
                        className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5 text-sm transition motion-fast ${
                          isPicked ? "bg-brand-50/70" : ""
                        } ${hasBarcode ? "" : "opacity-75"}`}
                      >
                        <input
                          type="checkbox"
                          checked={isPicked}
                          disabled={!hasBarcode}
                          onChange={() => toggle(p, v)}
                          aria-label={`${v.sku} লেবেলের জন্য বাছাই`}
                          className="h-5 w-5 shrink-0 accent-brand-600 disabled:opacity-40"
                        />
                        <span className="font-mono font-medium">{v.sku}</span>
                        {attrsText(v) ? <span className="text-text-muted">{attrsText(v)}</span> : null}
                        <span className="font-mono tabular-nums">{formatPoisha(v.pricePoisha)}</span>
                        {hasBarcode ? (
                          <span className="font-mono text-xs text-text-subtle">বারকোড: {v.barcode}</span>
                        ) : (
                          <span className="inline-flex h-6 items-center rounded-full bg-amber-50 px-2.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                            বারকোড নেই — লেবেল হবে না
                          </span>
                        )}
                        {isPicked ? (
                          <label className="ml-auto flex items-center gap-2 text-xs font-medium text-text-muted">
                            কপি
                            <input
                              type="number"
                              min={1}
                              max={500}
                              value={selected.get(v.id)?.copies ?? 1}
                              onChange={(e) => setCopies(v.id, Number(e.target.value))}
                              className="min-h-[44px] w-24 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
                            />
                          </label>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
            <Icon name="settings" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">লেবেলের সেটিং</h2>
        </div>
        <div className="grid gap-2 text-sm">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 transition motion-fast hover:bg-surface-2">
            <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} className="h-5 w-5 shrink-0 accent-brand-600" />
            দাম দেখান
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 transition motion-fast hover:bg-surface-2">
            <input type="checkbox" checked={showShopName} onChange={(e) => setShowShopName(e.target.checked)} className="h-5 w-5 shrink-0 accent-brand-600" />
            দোকানের নাম দেখান
          </label>
          {showShopName ? (
            <input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="দোকানের নাম"
              className={inputCls}
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-xs text-text-muted ring-1 ring-inset ring-black/5">
            {selections.length}টি ভ্যারিয়েন্ট বাছাই হয়েছে
          </span>
          <span className="inline-flex h-6 items-center rounded-full bg-brand-50 px-2.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
            মোট {totalLabels}টি লেবেল
          </span>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={totalLabels === 0}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-base font-semibold text-white shadow-md transition motion-fast hover:bg-emerald-700 hover:shadow-lift disabled:opacity-50"
        >
          <Icon name="check" size={18} />
          লেবেল ছাপুন ({totalLabels}টি)
        </button>
        {totalLabels === 0 ? <p className="text-xs leading-relaxed text-text-subtle">ছাপতে অন্তত একটি বারকোডওয়ালা ভ্যারিয়েন্ট বেছে নিন।</p> : null}
      </Card>
      </div>

      {totalLabels > 0 ? (
        <Card className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-base font-semibold text-text-main">ছাপার শিট — প্রিভিউ</h2>
            <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs text-text-muted ring-1 ring-inset ring-black/5">
              লেবেল 58mm × 40mm
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl bg-surface-2/70 p-3">
          <div id="barcode-label-sheet" className="flex flex-wrap gap-[3mm] bg-white p-2">
            {sheetLabels.map((s, i) => (
              <div
                key={`${s.variant.id}-${i}`}
                className="flex flex-col items-center justify-between overflow-hidden border border-dashed border-neutral-300 px-[2mm] py-[1.5mm] text-center"
                style={{ width: "58mm", height: "40mm" }}
              >
                {showShopName && shopName.trim() !== "" ? (
                  <p className="w-full truncate text-[9px] font-medium text-neutral-600">{shopName.trim()}</p>
                ) : null}
                <p className="w-full truncate text-[11px] font-semibold leading-tight text-neutral-900">{s.product.titleBn}</p>
                {attrsText(s.variant) ? (
                  <p className="w-full truncate text-[9px] leading-tight text-neutral-600">{attrsText(s.variant)}</p>
                ) : null}
                <div className="w-full px-1">
                  <BarcodeSvg value={s.variant.barcode as string} />
                </div>
                <p className="font-mono text-[9px] tracking-wider text-neutral-800">{s.variant.barcode}</p>
                {showPrice ? (
                  <p className="font-mono text-[11px] font-bold text-neutral-900">{formatPoisha(s.variant.pricePoisha)}</p>
                ) : null}
              </div>
            ))}
          </div>
          </div>
        </Card>
      ) : (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center shadow-card print:hidden">
          <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <Icon name="tag" size={28} />
          </span>
          <h2 className="mt-4 font-display text-base font-semibold text-text-main">ছাপার শিট — প্রিভিউ</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-text-muted">
            ভ্যারিয়েন্ট বাছাই করলেই এখানে ছাপার শিটের লাইভ প্রিভিউ দেখা যাবে — যেভাবে দেখছেন, ঠিক সেভাবেই ছাপা হবে।
          </p>
        </div>
      )}
    </div>
  );
}
