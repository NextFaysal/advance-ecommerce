"use client";

/**
 * "আবার অর্ডার করুন" (buy again) — plan 17 batch O2.
 *
 * Flow: POST /api/v1/public/account/orders/[id]/reorder resolves the
 * past order against the live catalog (current price + stock, per-item
 * skip reasons). The returned items are MERGED into the guest cart —
 * the same localStorage cart checkout reads — via the shared
 * addItemToGuestCart helper: quantities add onto whatever is already
 * in the cart, capped at current stock, and the stored price snapshot
 * refreshes to today's price. Nothing is replaced and nothing is
 * ordered yet: the customer still reviews everything at checkout,
 * which re-validates price and stock server-side.
 *
 * The per-item report (skips + price changes) is shown inline here
 * before the customer moves on, and a copy is stashed in
 * sessionStorage ("advance-ecommerce:reorder-report") so a checkout
 * surface can pick it up later. Skip reasons arrive from the API as
 * {reasonBn, reasonEn} pairs and are picked by the active locale.
 */
import { useState } from "react";
import { addItemToGuestCart } from "@/cart/components/AddToCartButton";
import { BdtAmount } from "@/components/ui/numerals";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { ACCOUNT_STRINGS } from "./strings";

interface ReorderAddedItem {
  variantId: string;
  productId: string;
  productSlug: string;
  name: string;
  sku: string;
  quantity: number;
  requestedQuantity: number;
  unitPricePoisha: number;
  previousUnitPricePoisha: number;
  priceChanged: boolean;
  availableStock: number;
  imageUrl?: string;
}

interface ReorderSkippedItem {
  variantId: string;
  name: string;
  sku: string;
  requestedQuantity: number;
  reason: string;
  reasonBn: string;
  reasonEn: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; addedUnits: number; items: ReorderAddedItem[]; skipped: ReorderSkippedItem[] };

const REPORT_KEY = "advance-ecommerce:reorder-report";

export default function ReorderButton({ orderId, orderNo }: { orderId: string; orderNo: string }) {
  const { locale } = useLocale();
  const s = pick(locale, ACCOUNT_STRINGS);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function handleReorder() {
    setPhase({ kind: "loading" });
    try {
      const res = await fetch(`/api/v1/public/account/orders/${encodeURIComponent(orderId)}/reorder`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as {
        data?: { orderNo: string; items: ReorderAddedItem[]; skipped: ReorderSkippedItem[] };
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.data) {
        setPhase({
          kind: "error",
          message:
            res.status === 401
              ? s.reorderSessionExpired
              : (body?.error?.message ?? s.reorderGenericError),
        });
        return;
      }
      const { items, skipped } = body.data;
      // MERGE into the existing guest cart (never replace): the shared
      // helper adds quantities per variant, caps at current stock and
      // refreshes the price snapshot to the current price.
      let addedUnits = 0;
      for (const item of items) {
        const result = addItemToGuestCart({
          productId: item.productId,
          productTitleBn: item.name,
          variant: {
            variantId: item.variantId,
            sku: item.sku,
            unitPricePoisha: item.unitPricePoisha,
            stock: item.availableStock,
            imageUrl: item.imageUrl ?? null,
          },
          quantity: item.quantity,
        });
        addedUnits += result.addedQuantity;
      }
      try {
        window.sessionStorage.setItem(
          REPORT_KEY,
          JSON.stringify({
            orderNo,
            at: new Date().toISOString(),
            skipped,
            priceChanges: items
              .filter((i) => i.priceChanged)
              .map((i) => ({
                name: i.name,
                previousUnitPricePoisha: i.previousUnitPricePoisha,
                unitPricePoisha: i.unitPricePoisha,
              })),
          }),
        );
      } catch {
        // Private mode etc. — the inline report below still shows everything.
      }
      setPhase({ kind: "done", addedUnits, items, skipped });
    } catch {
      setPhase({ kind: "error", message: s.reorderNetworkError });
    }
  }

  if (phase.kind === "done") {
    const { items, skipped, addedUnits } = phase;
    return (
      <div className="rounded-xl bg-surface-2 p-3 text-sm" role="status">
        <p className="font-semibold text-text-main">
          {items.length > 0
            ? addedUnits > 0
              ? interpolate(s.reorderAdded, { count: addedUnits })
              : s.reorderAlreadyInCart
            : s.reorderNoneAdded}
        </p>
        {items.length > 0 ? (
          <ul className="mt-2 space-y-1.5 leading-6 text-text-muted">
            {items.map((item) => (
              <li key={item.variantId}>
                {item.name} × {item.quantity}
                {item.quantity < item.requestedQuantity ? (
                  <span> {interpolate(s.reorderStockAdjusted, { requested: item.requestedQuantity, quantity: item.quantity })}</span>
                ) : null}
                {item.priceChanged ? (
                  <span className="block text-xs">
                    {locale === "bn" ? (
                      <>দাম বদলেছে — আগে <BdtAmount poisha={item.previousUnitPricePoisha} /> → এখন <BdtAmount poisha={item.unitPricePoisha} /></>
                    ) : (
                      <>Price changed — was <BdtAmount poisha={item.previousUnitPricePoisha} /> → now <BdtAmount poisha={item.unitPricePoisha} /></>
                    )}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {skipped.length > 0 ? (
          <ul className="mt-2 space-y-1.5 leading-6 text-text-muted">
            {skipped.map((item) => (
              <li key={item.variantId}>
                <span className="text-text-main">{item.name}</span> — {locale === "bn" ? item.reasonBn : item.reasonEn}
              </li>
            ))}
          </ul>
        ) : null}
        {items.length > 0 ? (
          <a
            href={`/checkout?reorder=${encodeURIComponent(orderNo)}`}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white transition hover:bg-brand-700"
          >
            {s.reorderGoCheckout}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleReorder}
        disabled={phase.kind === "loading"}
        className="inline-flex min-h-10 items-center rounded-lg border border-brand-600 px-3.5 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        {phase.kind === "loading" ? s.reorderAdding : s.reorderButton}
      </button>
      {phase.kind === "error" ? (
        <p className="mt-1.5 text-xs leading-5 text-danger" role="alert">
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}
