/**
 * Boighor CartPage slot — doc 27 T-C.
 *
 * The /cart route renders the EXISTING CartPageClient completely
 * unchanged — same cart store, same checkout summary, same
 * shipping/coupon logic — inside the package's visual frame (the
 * pale-blue listing background the PDP and checkout also sit on).
 * Cart logic is never forked by a theme.
 */
import CartPageClient from "@/cart/components/CartPageClient";
import type { ThemeCartPageProps } from "../slots";

export default function BoighorCartPage(props: ThemeCartPageProps) {
  return (
    <div className="bg-surface-2">
      <CartPageClient {...props} />
    </div>
  );
}
