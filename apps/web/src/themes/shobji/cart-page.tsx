/**
 * Shobji CartPage slot — doc 27 theme T-B.
 *
 * The platform's /cart route keeps working under this package: it
 * renders the EXISTING CartPageClient completely unchanged — same
 * cart store, same checkout summary, same shipping/coupon logic —
 * inside the package's visual frame (the lavender listing
 * background the shop and PDP also sit on). Cart logic is never
 * forked by a theme.
 */
import CartPageClient from "@/cart/components/CartPageClient";
import type { ThemeCartPageProps } from "../slots";

export default function ShobjiCartPage(props: ThemeCartPageProps) {
  return (
    <div className="bg-surface-2">
      <CartPageClient {...props} />
    </div>
  );
}
