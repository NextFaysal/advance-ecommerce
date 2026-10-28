/**
 * PdpPriceBlock — the PDP price cluster (doc 32 P1), extracted from
 * the Aurora buy card: the display price (single or range), the
 * struck-through compare-at price and the discount pill, in one
 * presentational unit every composition can render identically.
 *
 * The CTA half of the price/buy cluster already has its shared
 * component — BuyBoxActions (src/cart/components) owns variant
 * picking, quantity and the guest-cart write — so this block is
 * deliberately only the price presentation that used to be re-typed
 * per composition. It derives nothing: the caller passes the same
 * display values the page already computed (min/max, discount), and
 * money renders through BdtAmount/DigitText, so the numerals
 * preference flows exactly as before (doc 32 §0.5). The one string
 * (the "off" suffix on the discount pill) arrives as a prop from
 * the caller's dictionary — no copy lives here.
 *
 * Server-safe: no hooks of its own; the numerals leaves it renders
 * are the same client islands the compositions already use.
 */
import { BdtAmount, DigitText } from "@/components/ui/numerals";

export function PdpPriceBlock({
  minPoisha,
  maxPoisha,
  hasRange = false,
  compareAtPoisha,
  discountPct,
  discountOffText,
  className = "",
}: {
  /** Lowest display price, integer poisha. */
  minPoisha: number;
  /** Highest display price (only read when hasRange). */
  maxPoisha?: number;
  hasRange?: boolean;
  /** Compare-at price for the strikethrough, when a discount shows. */
  compareAtPoisha?: number | null;
  /** Discount percentage for the pill, when a discount shows. */
  discountPct?: number | null;
  /** The dictionary's "off" suffix (e.g. "ছাড়" / "OFF"). */
  discountOffText?: string;
  className?: string;
}) {
  const showDiscount =
    compareAtPoisha != null && discountPct != null && discountOffText != null
      ? { compareAtPoisha, discountPct, discountOffText }
      : null;
  return (
    <p className={`flex flex-wrap items-baseline gap-x-3 gap-y-1.5 ${className}`}>
      <span className="font-display text-4xl font-extrabold tabular-nums text-brand-700 dark:text-brand-300">
        <BdtAmount poisha={minPoisha} />
        {hasRange && maxPoisha != null ? (
          <span className="text-[1.35rem]">
            {" "}
            – <BdtAmount poisha={maxPoisha} />
          </span>
        ) : null}
      </span>
      {showDiscount ? (
        <>
          <BdtAmount
            poisha={showDiscount.compareAtPoisha}
            className="text-lg tabular-nums text-text-subtle line-through"
          />
          <span className="rounded-full bg-danger px-3 py-1 text-[13px] font-bold text-white shadow-sm">
            <DigitText text={`${showDiscount.discountPct}%`} /> {showDiscount.discountOffText}
          </span>
        </>
      ) : null}
    </p>
  );
}
