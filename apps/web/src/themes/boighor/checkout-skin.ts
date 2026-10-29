/**
 * Boighor CheckoutSkin — doc 27 T-C.
 *
 * The checkout page resolves its three class constants from the
 * active package's skin (skin-registry.ts) — logic is untouched.
 * This package's skin follows the catalogue layout: white inputs
 * with a light border and the package's 0.5rem radius, a blue
 * focus ring (under this package the platform's primary/ring
 * tokens ARE the blue), payment tiles with a pale-blue selected
 * fill (the package's surface tint, #EAF2FB) plus the blue ring,
 * and slot cards in the same family. Sizes keep Aurora's heights
 * so the checkout's layout rhythm is unchanged.
 */
import type { CheckoutSkin } from "../slots";

export const BOIGHOR_CHECKOUT_SKIN: CheckoutSkin = {
  INPUT_CLASS:
    "h-12 w-full rounded-lg border border-input bg-card px-3.5 text-[15px] text-text-main shadow-sm outline-none transition placeholder:text-text-subtle focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-60",
  PAYMENT_TILE_CLASS:
    "flex min-h-[52px] cursor-pointer items-start gap-2.5 rounded-lg border border-input bg-card px-3 py-2.5 shadow-sm transition duration-200 has-[:checked]:border-primary has-[:checked]:bg-surface-2 has-[:checked]:ring-2 has-[:checked]:ring-ring/40 hover:border-primary/50",
  SLOT_CARD_CLASS:
    "flex min-h-[52px] cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-2.5 text-left shadow-sm transition duration-200 has-[:checked]:border-primary has-[:checked]:bg-surface-2 has-[:checked]:ring-2 has-[:checked]:ring-ring/40 hover:border-primary/50",
  // P4 surfaces (doc 32): section cards step the catalogue radius up
  // one notch (rounded-xl), same border/shadow language; the summary
  // panel sits on the package's surface tint (bg-surface-2, the
  // selected-tile fill); CTAs keep the platform brand-gradient (blue
  // under this package) at the family's rounded-lg; the sticky bar
  // keeps the platform geometry with a neutral shadow.
  SECTION_CARD_CLASS:
    "rounded-xl border border-input bg-card p-5 shadow-sm",
  SUMMARY_PANEL_CLASS:
    "rounded-xl border border-input bg-surface-2 p-5 shadow-sm",
  PRIMARY_CTA_CLASS:
    "brand-gradient h-12 w-full rounded-lg text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
  STICKY_BAR_CLASS:
    "fixed inset-x-0 bottom-0 z-40 border-t border-input bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden",
  STICKY_CTA_CLASS:
    "brand-gradient flex h-12 shrink-0 items-center gap-1.5 rounded-lg px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
};
