/**
 * Aurora CheckoutSkin — doc 25 §1.4 / wave S3b.
 *
 * The checkout page's three styling constants, with their CURRENT
 * values copied verbatim from app/(store)/checkout/page.tsx (where
 * they lived as page-local constants before S3b). The checkout page
 * now consumes them from the resolved skin; for Aurora the strings
 * — and therefore every rendered class — are identical to before.
 *
 * Data only (plain strings): safe in any bundle, and the exact
 * values a future package's skin overrides key-by-key.
 */
import type { CheckoutSkin } from "../slots";

export const AURORA_CHECKOUT_SKIN: CheckoutSkin = {
  // Responsive pass (Design v3 §3): single-column flow at every width,
  // 44px+ touch targets (h-12 fields, 52px payment tiles), numeric keypad
  // hint on the phone field, and a sticky order-summary bar on small
  // screens (real cart totals). Field names/values and validation are
  // exactly as before.
  INPUT_CLASS:
    "h-12 w-full rounded-xl border border-border bg-card px-4 text-sm text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30",
  PAYMENT_TILE_CLASS:
    "inline-flex h-[52px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 transition has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:ring-1 has-[:checked]:ring-brand-500/40",
  // Delivery-slot radio cards (OD3): same checked-tile language as the
  // payment tiles, sized for a Bn label + En/time line.
  SLOT_CARD_CLASS:
    "flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 transition has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:ring-1 has-[:checked]:ring-brand-500/40",
};
