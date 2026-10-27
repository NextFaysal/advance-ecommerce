"use client";

/**
 * Neel PDP action grid (doc 27 T-E) — a 2×2 button grid, as a
 * client component:
 *
 *   ADD TO CART      (solid primary blue)
 *   BUY NOW          (solid warm orange — this package's accent)
 *   Order On WhatsApp (solid WhatsApp green) — only with a number
 *   Call For Order    (solid navy)           — only with a number
 *
 * The grid is a pure presentation of callbacks owned by
 * pdp-buy-section.tsx (the variant/quantity state machine, which
 * performs the actual cart writes through the platform's
 * addItemToGuestCart — the same helper BuyBoxActions uses). This
 * component never touches the cart itself.
 *
 * WhatsApp / Call: the platform exposes NO public storefront
 * setting carrying a store WhatsApp or hotline number today (the
 * setup wizard's `general.store.phone` is not public, and Meta's
 * whatsapp_* keys are non-public API credentials — not a dialable
 * number). The buy section therefore receives no numbers and
 * these two buttons are OMITTED — never rendered with an invented
 * number. The props are the seam: pass a configured number and
 * the buttons light up with wa.me / tel: links, the WhatsApp one
 * carrying our own prefilled order text.
 */
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { NEEL_COLORS } from "./tokens";
import { NEEL_STRINGS } from "./strings";

export interface NeelPdpActionsProps {
  /** Add the selected variant + quantity to the guest cart. */
  onAdd: () => void;
  /** Add, then navigate to /checkout (BuyBoxActions' semantics). */
  onBuyNow: () => void;
  /** Sold out / force-unavailable: both purchase buttons disable. */
  outOfStock: boolean;
  /** Label overrides (PREORDER products), mirroring BuyBoxActions. */
  ctaLabel?: string;
  buyNowLabel?: string;
  unavailableLabel?: string;
  /** Configured store WhatsApp number (international digits), or
   *  null/undefined = button omitted. */
  whatsappNumber?: string | null;
  /** Configured store hotline number, or null/undefined = omitted. */
  callNumber?: string | null;
  /** Prefill for the WhatsApp order text (our own wording). */
  productTitleBn: string;
}

const BTN =
  "flex h-12 items-center justify-center gap-2 rounded-md px-3 text-sm font-bold uppercase tracking-wide text-white shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export default function NeelPdpActions({
  onAdd,
  onBuyNow,
  outOfStock,
  ctaLabel,
  buyNowLabel,
  unavailableLabel,
  whatsappNumber,
  callNumber,
  productTitleBn,
}: NeelPdpActionsProps) {
  const { locale } = useLocale();
  const s = pick(locale, NEEL_STRINGS);
  const waDigits = whatsappNumber ? whatsappNumber.replace(/[^0-9]/g, "") : "";
  const waText = encodeURIComponent(
    interpolate(s.waMessage, { title: productTitleBn }),
  );

  return (
    <div className="grid grid-cols-2 gap-2.5">
      <button
        type="button"
        onClick={onAdd}
        disabled={outOfStock}
        className={`${BTN} bg-primary hover:opacity-90`}
      >
        <Icon name="cart" size={18} />
        {outOfStock ? (unavailableLabel ?? s.outOfStock) : (ctaLabel ?? s.addToCartLabel)}
      </button>
      <button
        type="button"
        onClick={onBuyNow}
        disabled={outOfStock}
        className={`${BTN} bg-accent hover:opacity-90`}
      >
        {buyNowLabel ?? s.buyNowLabel}
      </button>
      {waDigits ? (
        <a
          href={`https://wa.me/${waDigits}?text=${waText}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${BTN} hover:opacity-90`}
          style={{ backgroundColor: NEEL_COLORS.whatsappGreen }}
        >
          <Icon name="info" size={18} />
          {s.whatsappOrder}
        </a>
      ) : null}
      {callNumber ? (
        <a
          href={`tel:${callNumber.replace(/[^0-9+]/g, "")}`}
          className={`${BTN} hover:opacity-90`}
          style={{ backgroundColor: NEEL_COLORS.callNavy }}
        >
          <Icon name="phone" size={18} />
          {s.callForOrder}
        </a>
      ) : null}
    </div>
  );
}
