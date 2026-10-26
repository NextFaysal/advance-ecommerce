"use client";

// Shared cart view — ADV-19 (doc 22). Renders the lines decoded from
// a VERIFIED cart-share token (verification happens server-side in
// the page shell; this component never sees an unverified token).
// Every line is re-resolved against the LIVE catalog passed by the
// shell: prices and stock shown here are the catalog's current
// values, never anything from the link. Lines whose product/variant
// left the catalog or sold out are shown struck-through and cannot
// be added. "কার্টে যোগ করুন" merges the available lines into the
// visitor's own guest cart via the cart system's add helper (which
// caps at live stock and persists to localStorage).
import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Icon } from "@/components/ui/icon";
import type { PublicProduct } from "@/catalog/types";
import { addItemToGuestCart, CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";
import type { CartShareLine } from "../token";

interface SharedCartClientProps {
  lines: CartShareLine[];
  catalogProducts: PublicProduct[];
}

interface ResolvedShareLine {
  line: CartShareLine;
  product: PublicProduct | null;
  variant: PublicProduct["variants"][number] | null;
  available: boolean;
  cappedQuantity: number;
}

export function SharedCartClient({ lines, catalogProducts }: SharedCartClientProps) {
  const [added, setAdded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const resolved = useMemo<ResolvedShareLine[]>(
    () =>
      lines.map((line) => {
        const product =
          catalogProducts.find((p) => p.variants.some((v) => v.id === line.variantId)) ?? null;
        const variant = product?.variants.find((v) => v.id === line.variantId) ?? null;
        const available = !!variant && variant.isActive && variant.stock > 0;
        return {
          line,
          product,
          variant,
          available,
          cappedQuantity: variant ? Math.min(line.quantity, variant.stock) : 0,
        };
      }),
    [lines, catalogProducts],
  );

  const availableLines = resolved.filter((r) => r.available && r.cappedQuantity > 0);
  const totalPoisha = availableLines.reduce(
    (sum, r) => sum + (r.variant?.pricePoisha ?? 0) * r.cappedQuantity,
    0,
  );

  function addAll() {
    let addedCount = 0;
    let capped = false;
    for (const r of availableLines) {
      if (!r.product || !r.variant) continue;
      const result = addItemToGuestCart({
        productId: r.product.id,
        productTitleBn: r.product.title.bn,
        variant: {
          variantId: r.variant.id,
          sku: r.variant.sku,
          unitPricePoisha: r.variant.pricePoisha,
          compareAtPoisha: r.variant.compareAtPoisha,
          stock: r.variant.stock,
          imageUrl: r.variant.imageUrl ?? r.product.images[0]?.url ?? null,
        },
        quantity: r.line.quantity,
      });
      if (result.addedQuantity > 0) addedCount += 1;
      if (result.capped) capped = true;
    }
    window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
    setAdded(true);
    setNotice(
      addedCount === 0
        ? "কিছুই যোগ করা যায়নি — পণ্যগুলোর স্টক শেষ হয়ে গেছে।"
        : capped
          ? `${addedCount}টি পণ্য আপনার কার্টে যোগ হয়েছে (কিছু পণ্য স্টক অনুযায়ী কম পরিমাণে)।`
          : `${addedCount}টি পণ্য আপনার কার্টে যোগ হয়েছে।`,
    );
  }

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-6 sm:px-6">
      <h1 className="font-display text-h1">শেয়ার করা কার্ট</h1>
      <p className="mt-2 text-sm leading-6 text-text-muted">
        কেউ আপনার সঙ্গে এই কার্টটি শেয়ার করেছেন। দাম ও স্টক এই মুহূর্তের লাইভ তথ্য অনুযায়ী
        দেখানো হচ্ছে — লিংকে কোনো দাম সংরক্ষিত থাকে না।
      </p>

      <Card className="mt-6 p-5">
        <ul className="divide-y divide-border">
          {resolved.map((r) => (
            <li key={r.line.variantId} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className={`text-sm font-medium ${r.available ? "text-text-main" : "text-text-muted line-through"}`}>
                  {r.product ? r.product.title.bn : "পণ্যটি আর পাওয়া যাচ্ছে না"}
                </p>
                {r.variant ? (
                  <p className="mt-0.5 text-xs text-text-muted">
                    {r.variant.sku}
                    {Object.values(r.variant.attributes).length > 0
                      ? ` · ${Object.values(r.variant.attributes).join(" · ")}`
                      : ""}
                    {" "}· পরিমাণ: {r.cappedQuantity}
                    {r.cappedQuantity < r.line.quantity ? ` (শেয়ারে ছিল ${r.line.quantity})` : ""}
                  </p>
                ) : null}
                {!r.available && (
                  <p className="mt-0.5 text-xs text-rose-600">
                    {r.variant ? "স্টক শেষ — এই পণ্যটি যোগ করা যাবে না।" : "পণ্যটি এখন আর বিক্রির জন্য নেই।"}
                  </p>
                )}
              </div>
              {r.variant && r.available ? (
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  <Money poisha={r.variant.pricePoisha * r.cappedQuantity} />
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <span className="text-sm text-text-muted">মোট (লাইভ দামে)</span>
          <span className="text-base font-bold tabular-nums">
            <Money poisha={totalPoisha} />
          </span>
        </div>

        {notice && (
          <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={addAll} disabled={added || availableLines.length === 0} className="min-h-[44px]">
            <Icon name="cart" size={16} /> কার্টে যোগ করুন
          </Button>
          {added && (
            <Link
              href="/cart"
              className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
            >
              আপনার কার্ট দেখুন
            </Link>
          )}
        </div>
      </Card>
    </main>
  );
}
