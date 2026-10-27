"use client";

/**
 * Haat "আজকের অফার" rail (doc 27 theme T-A) — client island,
 * gated by the package's `showFlashRail` merchant option (read
 * from the ThemeView context).
 *
 * A dense marketplace rail: the store's featured products (the
 * home page's fetch order, passed in as props) as narrow standard
 * cards in a horizontally scrollable track — six across on wide
 * screens — under an orange band heading.
 *
 * Honesty note: the platform carries NO flash-sale schedule or
 * per-product sales-count signal in the public shape, so this
 * rail has NO countdown timer and NO "sold" figures — a timer
 * counting to an invented deadline would be a lie. The rail is
 * the featured list under our own section label ("আজকের অফার");
 * each card's discount chip comes only from that product's real
 * compare-at price (see product-card.tsx).
 */
import { useRef } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { PublicProduct } from "@/catalog/types";
import { useThemeView } from "../theme-view";
import { HaatProductCard } from "./product-card";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { HAAT_STRINGS } from "./strings";

export default function HaatHomeFlashRail({
  products,
}: {
  products: PublicProduct[];
}) {
  const { locale } = useLocale();
  const s = pick(locale, HAAT_STRINGS);
  const themeView = useThemeView();
  const trackRef = useRef<HTMLDivElement>(null);

  if (themeView.options.showFlashRail === false) return null;
  if (products.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="mt-8" aria-label={s.flashAria}>
      {/* Orange band heading — the rail's marketplace signature */}
      <div className="flex items-center justify-between gap-3 rounded-t bg-primary px-4 py-2.5 text-white shadow-card">
        <h2 className="flex items-center gap-2 font-display text-lg font-extrabold sm:text-xl">
          <Icon name="tag" size={20} />
          {s.flashTitle}
        </h2>
        <div className="flex items-center gap-2">
          <Link
            href="/shop"
            className="hidden text-sm font-bold text-white hover:underline sm:block"
          >
            {s.flashViewAll}
          </Link>
          <div className="hidden gap-1.5 md:flex">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              aria-label={s.prevProduct}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
            >
              <Icon name="chevron-right" size={16} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              aria-label={s.nextProduct}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
            >
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-b border border-t-0 border-border bg-card p-3 shadow-card">
        <div
          ref={trackRef}
          className="scrollbar-none -mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1"
        >
          {products.map((p) => (
            <div
              key={p.id}
              className="w-[160px] shrink-0 snap-start sm:w-[190px] xl:w-[212px]"
            >
              <HaatProductCard product={p} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
