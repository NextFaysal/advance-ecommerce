"use client";

/**
 * Bazaar "Top Selling" rail (doc 24 wave T3 / doc 25 wave S4b) —
 * client island: horizontal cards (BazaarProductCardHorizontal) in
 * a scrollable rail with orange circular arrow buttons.
 *
 * Honesty note: the platform carries NO per-product sales-count
 * signal in the public shape, so "Top Selling" here is the store's
 * own featured list — the home page's product fetch order — under
 * our own bilingual section label ("সেরা বিক্রি / Top Selling").
 * No sales figures, ranks or "sold" counts are printed anywhere in
 * the rail; the cards show only the real price/discount/type
 * signals the shared card anatomy uses.
 */
import { useRef } from "react";
import { Icon } from "@/components/ui/icon";
import type { PublicProduct } from "@/catalog/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { BazaarProductCardHorizontal } from "./product-card";
import { BAZAAR_STRINGS } from "./strings";
import { RAIL_FADE_CLASS } from "@/storefront-ux/responsive";

export default function BazaarHomeTopSelling({
  products,
}: {
  products: PublicProduct[];
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);

  if (products.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="mt-12" aria-label={s.topSellingAria}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">
            {s.topSelling}
          </h2>
          <span aria-hidden="true" className="mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
        </div>
        <div className="hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={s.prevProductsAria}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:opacity-90"
          >
            <Icon name="chevron-right" size={18} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={s.nextProductsAria}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:opacity-90"
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className={`scrollbar-none -mx-4 mt-5 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 ${RAIL_FADE_CLASS}`}
      >
        {products.map((p) => (
          <div key={p.id} className="w-[300px] shrink-0 snap-start sm:w-[360px]">
            <BazaarProductCardHorizontal product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
