/**
 * Haat CartPage slot — doc 27 theme T-A.
 *
 * The marketplace is drawer-first, but the platform's /cart
 * route keeps working under this package: it renders the
 * EXISTING CartPageClient completely unchanged — same cart
 * store, same checkout summary, same shipping/coupon logic —
 * inside the package's visual frame (the pale grey listing
 * background the PDP and shop also sit on). Cart logic is never
 * forked by a theme.
 */
import CartPageClient from "@/cart/components/CartPageClient";
import type { ThemeCartPageProps } from "../slots";

export default function HaatCartPage(props: ThemeCartPageProps) {
  return (
    <div className="bg-surface-2">
      <CartPageClient {...props} />
    </div>
  );
}
