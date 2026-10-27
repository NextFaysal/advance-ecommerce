/**
 * Neel CheckoutSkin — doc 27 T-E.
 *
 * The checkout page resolves its three class constants from the
 * active package's skin (skin-registry.ts) — logic is untouched.
 * This package's skin follows its marketplace dress: white inputs
 * with a light border and a SMALL radius, a blue focus ring
 * (under this package the platform's primary/ring tokens ARE the
 * blue), payment tiles with a pale-blue selected fill (#EAF2FA —
 * this palette's selected tint) plus the blue ring, and slot
 * cards in the same family. Sizes keep the platform's heights so
 * the checkout's layout rhythm is unchanged.
 */
import type { CheckoutSkin } from "../slots";

export const NEEL_CHECKOUT_SKIN: CheckoutSkin = {
  INPUT_CLASS:
    "h-12 w-full rounded-md border border-input bg-card px-3.5 text-[15px] text-text-main shadow-sm outline-none transition placeholder:text-text-subtle focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-60",
  PAYMENT_TILE_CLASS:
    "flex min-h-[52px] cursor-pointer items-start gap-2.5 rounded-md border border-input bg-card px-3 py-2.5 shadow-sm transition duration-200 has-[:checked]:border-primary has-[:checked]:bg-[#EAF2FA] has-[:checked]:ring-2 has-[:checked]:ring-ring/40 hover:border-primary/50",
  SLOT_CARD_CLASS:
    "flex min-h-[52px] cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2.5 text-left shadow-sm transition duration-200 has-[:checked]:border-primary has-[:checked]:bg-[#EAF2FA] has-[:checked]:ring-2 has-[:checked]:ring-ring/40 hover:border-primary/50",
};
