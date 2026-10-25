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
import { formatPoisha } from "@/components/ui/money";

const inputCls =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1 block text-xs font-medium text-text-muted";

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
    <div className="space-y-4">
      {/* Print isolation: only the sheet is visible on paper. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #barcode-label-sheet, #barcode-label-sheet * { visibility: visible !important; }
          #barcode-label-sheet { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 !important; border: none !important; background: #fff !important; }
          @page { margin: 8mm; }
        }
      `}</style>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
            placeholder="পণ্যের নাম বা SKU দিয়ে খুঁজুন (খালি রাখলে সাম্প্রতিক ৫০টি)"
            className={`${inputCls} min-w-64 flex-1`}
          />
          <button
            type="button"
            onClick={search}
            disabled={searching}
            className="min-h-[44px] rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
          >
            {searching ? "খোঁজা হচ্ছে…" : "খুঁজুন"}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-text-subtle">
          শুধু যেসব ভ্যারিয়েন্টে বারকোড আছে সেগুলোরই লেবেল হয় — বারকোড ছাড়া ভ্যারিয়েন্ট নিষ্ক্রিয় দেখাবে;
          আগে পণ্য এডিটরে গিয়ে বারকোড বসান।
        </p>
        {error ? (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {searched && products.length === 0 ? <p className="text-sm text-text-subtle">কোনো পণ্য মেলেনি।</p> : null}
        {products.length > 0 ? (
          <div className="space-y-3">
            {products.map((p) => (
              <div key={p.id} className="rounded-lg border border-border">
                <p className="border-b border-border bg-surface-2 px-3 py-2 text-sm font-medium">
                  {p.titleBn} <span className="font-mono text-xs font-normal text-text-subtle">{p.slug}</span>
                </p>
                <ul className="divide-y divide-border">
                  {p.variants.map((v) => {
                    const hasBarcode = typeof v.barcode === "string" && v.barcode.trim() !== "";
                    const isPicked = selected.has(v.id);
                    return (
                      <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={isPicked}
                          disabled={!hasBarcode}
                          onChange={() => toggle(p, v)}
                          aria-label={`${v.sku} লেবেলের জন্য বাছাই`}
                          className="h-4 w-4"
                        />
                        <span className="font-mono">{v.sku}</span>
                        {attrsText(v) ? <span className="text-text-muted">{attrsText(v)}</span> : null}
                        <span className="font-mono">{formatPoisha(v.pricePoisha)}</span>
                        {hasBarcode ? (
                          <span className="font-mono text-xs text-text-subtle">বারকোড: {v.barcode}</span>
                        ) : (
                          <span className="text-xs text-amber-700">বারকোড নেই — লেবেল হবে না</span>
                        )}
                        {isPicked ? (
                          <label className="ml-auto flex items-center gap-2 text-xs text-text-muted">
                            কপি
                            <input
                              type="number"
                              min={1}
                              max={500}
                              value={selected.get(v.id)?.copies ?? 1}
                              onChange={(e) => setCopies(v.id, Number(e.target.value))}
                              className="w-20 rounded-md border border-border bg-card px-2 py-1 text-sm"
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

      <Card className="space-y-3 p-4">
        <h2 className="font-display text-base font-semibold">লেবেলের সেটিং</h2>
        <div className="flex flex-wrap items-center gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} className="h-4 w-4" />
            দাম দেখান
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showShopName} onChange={(e) => setShowShopName(e.target.checked)} className="h-4 w-4" />
            দোকানের নাম দেখান
          </label>
          {showShopName ? (
            <input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="দোকানের নাম"
              className={`${inputCls} max-w-64`}
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={totalLabels === 0}
          className="min-h-[44px] rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          লেবেল ছাপুন ({totalLabels}টি)
        </button>
        {totalLabels === 0 ? <p className="text-xs text-text-subtle">ছাপতে অন্তত একটি বারকোডওয়ালা ভ্যারিয়েন্ট বেছে নিন।</p> : null}
      </Card>

      {totalLabels > 0 ? (
        <Card className="p-4">
          <h2 className="mb-3 font-display text-base font-semibold">ছাপার শিট — প্রিভিউ</h2>
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
        </Card>
      ) : null}
    </div>
  );
}
