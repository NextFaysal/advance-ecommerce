"use client";
/**
 * Landing product carousel (doc 34 L2) — the dynamic-source rail:
 * the doc-33 pattern (horizontal snap rail + edge fade + 44px arrow
 * targets) over the same LandingProductCard cells the grid uses.
 * Autoplay advances the rail every 4s, pauses on hover/focus, and
 * never runs under prefers-reduced-motion. Purely presentational:
 * the cards arrive fully resolved from the view model.
 */
import { useEffect, useRef, useState } from "react";
import { RAIL_FADE_CLASS } from "@/storefront-ux/responsive";
import { pick, type Locale } from "@/i18n/locale";
import { LANDING_STRINGS } from "../../strings";
import type { ResolvedOffer } from "../../render";
import { LandingProductCard } from "./LandingProductCard";

export function ProductCarousel({
  cards,
  locale,
  showPrice,
  showAddButton,
  autoplay,
}: {
  cards: ResolvedOffer[];
  locale: Locale;
  showPrice: boolean;
  showAddButton: boolean;
  autoplay: boolean;
}) {
  const s = pick(locale, LANDING_STRINGS);
  const railRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  const advance = (dir: 1 | -1 | 0) => {
    const el = railRef.current;
    if (!el) return;
    if (dir === 0) {
      // Autoplay step: wrap to the start at the end of the rail.
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + el.clientWidth * 0.8, behavior: "smooth" });
      return;
    }
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  useEffect(() => {
    if (!autoplay || paused || cards.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => advance(0), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, paused, cards.length]);

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        ref={railRef}
        className={`flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 ${RAIL_FADE_CLASS}`}
      >
        {cards.map((card) => (
          <div key={card.variantId} className="w-[70vw] max-w-[250px] shrink-0 snap-start">
            <LandingProductCard card={card} locale={locale} s={s} showPrice={showPrice} showAddButton={showAddButton} />
          </div>
        ))}
      </div>
      {cards.length > 1 ? (
        <>
          <button
            type="button"
            aria-label={s.carouselPrevAria}
            onClick={() => advance(-1)}
            className="absolute left-1 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-xl shadow-md transition hover:bg-surface-2"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={s.carouselNextAria}
            onClick={() => advance(1)}
            className="absolute right-1 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-xl shadow-md transition hover:bg-surface-2"
          >
            ›
          </button>
        </>
      ) : null}
    </div>
  );
}
