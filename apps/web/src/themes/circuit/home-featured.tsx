"use client";

/**
 * Circuit "ফিচার্ড পণ্য" rail (doc 27 T-D) — client island:
 * horizontal cards (CircuitProductCardHorizontal) in a scrollable
 * rail under a CENTRED heading (this package's section style),
 * with navy circular arrow buttons.
 *
 * Honesty note: the platform carries NO per-product sales-count
 * or ranking signal in the public shape, so this rail is the
 * store's own featured list — the home page's product fetch
 * order — under our own section label. No sales figures, ranks
 * or "sold" counts are printed anywhere in the rail.
 */
import { useRef } from "react";
import { Icon } from "@/components/ui/icon";
import type { PublicProduct } from "@/catalog/types";
import { CircuitProductCardHorizontal } from "./product-card";
import { CIRCUIT_COLORS } from "./tokens";

export default function CircuitHomeFeatured({
  products,
}: {
  products: PublicProduct[];
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  if (products.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="mt-12" aria-label="ফিচার্ড পণ্য">
      <div className="relative flex items-center justify-center">
        <div className="text-center">
          <h2 className="font-display text-xl font-extrabold text-text-main sm:text-2xl">
            ফিচার্ড পণ্য
          </h2>
          <span aria-hidden="true" className="mx-auto mt-1.5 block h-[3px] w-10 rounded-full bg-primary" />
        </div>
        <div className="absolute right-0 hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="আগের পণ্য"
            className="flex h-10 w-10 items-center justify-center rounded-full text-white shadow-card transition hover:opacity-90"
            style={{ backgroundColor: CIRCUIT_COLORS.navy }}
          >
            <Icon name="chevron-right" size={18} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="পরের পণ্য"
            className="flex h-10 w-10 items-center justify-center rounded-full text-white shadow-card transition hover:opacity-90"
            style={{ backgroundColor: CIRCUIT_COLORS.navy }}
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="scrollbar-none -mx-4 mt-5 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {products.map((p) => (
          <div key={p.id} className="w-[320px] shrink-0 snap-start sm:w-[380px]">
            <CircuitProductCardHorizontal product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
