"use client";

/**
 * Sticky buy bar — Part B wiring (Agent 21).
 * The visibility DECISION stays in the pure stickyBarState()
 * (src/storefront-ux/sticky-bar.ts). This component only MEASURES:
 * IntersectionObserver watches the buy box and the page footer, and a
 * scroll/resize listener feeds fresh metrics into stickyBarState().
 * Mobile-first: the bar renders only below the md breakpoint.
 */
import { useEffect, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { useDigitText } from "@/components/ui/numerals";
import { stickyBarState, type StickyBarState } from "../sticky-bar";

export function StickyBuyBar({
  titleBn,
  pricePoisha,
  inStock,
  buyBoxId = "buy-box",
}: {
  titleBn: string;
  /** Integer poisha — lowest active variant price. */
  pricePoisha: number;
  inStock: boolean;
  buyBoxId?: string;
}) {
  const digits = useDigitText();
  const [state, setState] = useState<StickyBarState>({ visible: false, reason: "buy_box_visible" });

  useEffect(() => {
    const buyBox = document.getElementById(buyBoxId);
    const footer = document.querySelector("footer");

    function measure() {
      const boxRect = buyBox?.getBoundingClientRect();
      const footRect = footer?.getBoundingClientRect();
      setState(
        stickyBarState({
          scrollY: window.scrollY,
          buyBoxBottom: boxRect ? boxRect.bottom + window.scrollY : 0,
          footerTop: footRect ? footRect.top + window.scrollY : null,
          viewportHeight: window.innerHeight,
          inStock,
        }),
      );
    }

    measure();
    const observer = new IntersectionObserver(measure, { threshold: 0 });
    if (buyBox) observer.observe(buyBox);
    if (footer) observer.observe(footer);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [buyBoxId, inStock]);

  if (!state.visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-2px_10px_rgba(0,0,0,0.08)] backdrop-blur md:hidden">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-main">{titleBn}</p>
          <p className="text-base font-bold text-brand-700 dark:text-brand-300">{digits(formatBdt(pricePoisha))} থেকে</p>
        </div>
        {/* Checkout (Step 12) wires this to cart/order creation, same as the buy box. */}
        <button type="button" className="min-h-11 shrink-0 rounded-lg bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-card transition hover:bg-brand-700 active:scale-[0.98]">
          অর্ডার করুন
        </button>
      </div>
    </div>
  );
}
