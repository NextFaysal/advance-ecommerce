/**
 * Bazaar CartPage slot — doc 24 wave T6 / doc 25 wave S4b.
 *
 * The reference storefront is drawer-first, but the platform's
 * /cart route keeps working under this package: it renders the
 * EXISTING CartPageClient completely unchanged — same cart store,
 * same checkout summary, same shipping/coupon logic — inside the
 * package's visual frame (the pale listing background the PDP and
 * checkout also sit on). Cart logic is never forked by a theme.
 */
import CartPageClient from "@/cart/components/CartPageClient";
import type { ThemeCartPageProps } from "../slots";

export default function BazaarCartPage(props: ThemeCartPageProps) {
  return (
    <div className="bg-surface-2">
      <CartPageClient {...props} />
    </div>
  );
}
