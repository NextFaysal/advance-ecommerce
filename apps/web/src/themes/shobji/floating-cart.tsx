"use client";

/**
 * Shobji floating cart tab (doc 27 theme T-B) — a purple tab fixed
 * to the RIGHT edge of the viewport: cart icon, the REAL item
 * count and the REAL subtotal from the guest cart store, and a
 * click that opens this package's cart drawer
 * (cart-drawer-events) — the exact mechanism the package's header
 * cart button uses.
 *
 * Mounted by the Header slot (the shell owns only Header/Footer;
 * floating elements belong to the header in this platform's
 * packages). Gated by the package's `showFloatingCart` option and
 * rendered only when the cart is non-empty (an empty ৳0 tab is
 * pure noise). Counts use the same data path as the header:
 * loadGuestCart + cartItemCount / cartSubtotalPoisha, refreshed on
 * storage/focus and CART_UPDATED_EVENT; SSR renders nothing
 * (values load after mount).
 *
 * Doc 33 R3 (§3.4 floating discipline): this tab is the package's
 * ONLY fixed element — it owns the right-edge zone alone (no support
 * stack, no back-to-top column), sits mid-edge so the bottom edge
 * stays free for page bars (StickyBuyBar / checkout bar), and its
 * right offset honours env(safe-area-inset-right) so a landscape
 * notch never clips it.
 */
import { useEffect, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { GUEST_CART_KEY, loadGuestCart } from "@/cart/persistence";
import { cartItemCount, cartSubtotalPoisha } from "@/cart/types";
import { CART_UPDATED_EVENT } from "@/cart/components/AddToCartButton";
import { Icon } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { useThemeView } from "../theme-view";
import { SHOBJI_STRINGS } from "./strings";
import { openCartDrawer } from "../cart-drawer-events";

export default function ShobjiFloatingCart() {
  const { locale } = useLocale();
  const s = pick(locale, SHOBJI_STRINGS);
  const digits = useDigitText();
  const themeView = useThemeView();
  const showFloatingCart = themeView.options.showFloatingCart !== false;

  const [count, setCount] = useState(0);
  const [totalPoisha, setTotalPoisha] = useState(0);

  useEffect(() => {
    function refresh() {
      const cart = loadGuestCart();
      setCount(cart ? cartItemCount(cart) : 0);
      setTotalPoisha(cart ? cartSubtotalPoisha(cart) : 0);
    }
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === GUEST_CART_KEY || e.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    window.addEventListener(CART_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(CART_UPDATED_EVENT, refresh);
    };
  }, []);

  if (!showFloatingCart || count <= 0) return null;

  return (
    <button
      type="button"
      onClick={openCartDrawer}
      aria-label={interpolate(s.floatingCartAria, { count, total: formatBdt(totalPoisha) })}
      className="fixed right-[max(0px,env(safe-area-inset-right))] top-1/3 z-40 flex flex-col items-center gap-0.5 rounded-l-xl bg-primary px-2.5 py-3 text-white shadow-pop transition hover:opacity-95"
    >
      <Icon name="cart" size={20} />
      <span className="text-[11px] font-bold leading-tight">
        {digits(interpolate(s.itemCountShort, { count }))}
      </span>
      <span className="text-[11px] font-semibold leading-tight">
        {digits(formatBdt(totalPoisha))}
      </span>
    </button>
  );
}
