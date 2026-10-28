"use client";

/**
 * Neel featured rail (doc 27 T-E) — client island: horizontal
 * cards (NeelProductCardHorizontal) in a scrollable rail with
 * blue circular arrow buttons.
 *
 * Honesty note: the platform carries NO per-product sales-count
 * signal in the public shape, so this rail is the store's own
 * featured list — the home page's product fetch order — under our
 * own section label ("নির্বাচিত পণ্য"). No sales figures, ranks
 * or "sold" counts are printed anywhere in the rail; the cards
 * show only the real price/discount/rating signals the shared
 * card anatomy uses.
 */
import { useRef } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { NEEL_STRINGS } from "./strings";
import { Icon } from "@/components/ui/icon";
import type { PublicProduct } from "@/catalog/types";
import { NeelProductCardHorizontal } from "./product-card";
import { RAIL_FADE_CLASS } from "@/storefront-ux/responsive";

export default function NeelHomeTopSelling({
  products,
}: {
  products: PublicProduct[];
}) {
  const { locale } = useLocale();
  const s = pick(locale, NEEL_STRINGS);
  const trackRef = useRef<HTMLDivElement>(null);

  if (products.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="mt-8 lg:mt-12" aria-label={s.featuredProducts}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">
            {s.featuredProducts}
          </h2>
          <span aria-hidden="true" className="mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
        </div>
        <div className="hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={s.prevProducts}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-card transition hover:opacity-90"
          >
            <Icon name="chevron-right" size={18} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={s.nextProducts}
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
            <NeelProductCardHorizontal product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
