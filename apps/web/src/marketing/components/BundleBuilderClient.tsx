"use client";

// Bundle builder client (ADV-18B): per-bundle quantity + add-to-
// cart. Add-to-cart uses the EXACT helper and input shape the PDP
// buy box uses (addItemToGuestCart with the bundle variant's
// snapshot), so the builder's cart line is indistinguishable from a
// PDP bundle line. Contents are FIXED by the bundle definition —
// the card says so; there is no component picking because the
// fulfilment seam deducts the fixed list (see bundle-builder.ts).
import { useState } from "react";
import Link from "next/link";
import { addItemToGuestCart } from "@/cart/components/AddToCartButton";
import { formatPoisha } from "@/components/ui/money";
import type { BundleBuild } from "@/marketing/bundle-builder";

function BundleCard({ bundle }: { bundle: BundleBuild }) {
  const cap = bundle.availableCount ?? bundle.variantStock;
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState<number | null>(null);

  const add = () => {
    const result = addItemToGuestCart({
      productId: bundle.productId,
      productTitleBn: bundle.titleBn,
      variant: {
        variantId: bundle.variantId,
        sku: bundle.variantSku,
        unitPricePoisha: bundle.bundlePricePoisha,
        stock: cap,
        imageUrl: bundle.imageUrl,
      },
      quantity,
    });
    setAdded(result.addedQuantity);
  };

  return (
    <article className="overflow-hidden rounded-3xl bg-surface shadow-md ring-1 ring-border">
      <div className="flex flex-wrap gap-5 p-6">
        {bundle.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bundle.imageUrl} alt={bundle.titleBn} className="h-36 w-36 rounded-2xl object-cover" loading="lazy" />
        ) : (
          <div className="flex h-36 w-36 items-center rounded-2xl bg-surface-2 px-3 text-center text-sm font-medium text-text-muted">
            {bundle.titleBn}
          </div>
        )}
        <div className="min-w-64 flex-1">
          <h2 className="text-xl font-extrabold text-text-main">
            <Link href={`/product/${bundle.slug}`} className="hover:underline">
              {bundle.titleBn}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-text-muted">বান্ডলের কম্পোনেন্ট নির্ধারিত — নিচের তালিকাটাই পাবেন।</p>
          <ul className="mt-3 divide-y divide-border text-sm">
            {bundle.components.map((c) => (
              <li key={c.variantId} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <span className="text-text-main">
                  {c.productSlug ? (
                    <Link href={`/product/${c.productSlug}`} className="font-medium hover:underline">
                      {c.titleBn || "কম্পোনেন্ট পণ্য"}
                    </Link>
                  ) : (
                    <span className="font-medium">{c.titleBn || "কম্পোনেন্ট পণ্য"}</span>
                  )}
                  {c.variantLabel ? <span className="text-text-subtle"> · {c.variantLabel}</span> : null}{" "}
                  <span className="text-text-subtle">× {c.quantity}</span>
                </span>
                <span className="font-mono text-text-muted">
                  {c.lineTotalPoisha !== null ? formatPoisha(c.lineTotalPoisha) : "—"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-0.5 text-sm">
            {bundle.componentsTotalPoisha !== null ? (
              <p className="text-text-muted">
                আলাদা কিনলে মোট: <span className="font-mono">{formatPoisha(bundle.componentsTotalPoisha)}</span>
              </p>
            ) : null}
            <p className="text-text-main">
              বান্ডল মূল্য: <span className="font-mono text-lg font-extrabold text-brand-700">{formatPoisha(bundle.bundlePricePoisha)}</span>
              {bundle.savingsPoisha !== null ? (
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  সাশ্রয় {formatPoisha(bundle.savingsPoisha)}
                </span>
              ) : null}
            </p>
            <p className="text-xs text-text-subtle">
              {bundle.available ? `পাওয়া যাচ্ছে${bundle.availableCount !== null ? ` — সর্বোচ্চ ${bundle.availableCount}টি` : ""}` : "এখন স্টকে নেই"}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-full ring-1 ring-border">
              <button
                type="button"
                aria-label="কম করুন"
                className="px-3 py-1.5 text-lg text-text-muted disabled:opacity-40"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                −
              </button>
              <span className="min-w-8 text-center font-bold">{quantity}</span>
              <button
                type="button"
                aria-label="বেশি করুন"
                className="px-3 py-1.5 text-lg text-text-muted disabled:opacity-40"
                disabled={quantity >= Math.max(1, cap)}
                onClick={() => setQuantity((q) => Math.min(Math.max(1, cap), q + 1))}
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={add}
              disabled={!bundle.available || cap <= 0}
              className="rounded-full bg-brand-600 px-5 py-2 font-bold text-white shadow transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              কার্টে যোগ করুন
            </button>
            {added !== null ? (
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300" role="status">
                {added > 0 ? `কার্টে যোগ হয়েছে (${added}টি) — ` : "স্টক সীমার কারণে যোগ হয়নি — "}
                <Link href="/cart" className="underline">
                  কার্ট দেখুন
                </Link>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function BundleBuilderClient({ bundles }: { bundles: BundleBuild[] }) {
  return (
    <div className="space-y-6">
      {bundles.map((bundle) => (
        <BundleCard key={bundle.productId} bundle={bundle} />
      ))}
    </div>
  );
}
