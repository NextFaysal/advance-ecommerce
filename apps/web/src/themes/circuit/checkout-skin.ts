/**
 * Circuit CheckoutSkin — doc 27 T-D.
 *
 * The checkout page resolves its three class constants from the
 * active package's skin (skin-registry.ts) — logic is untouched.
 * This package's skin follows its tech-store frame: white inputs
 * with a light border and the package's 10px-family radius, an
 * orange focus ring (under this package the platform's
 * primary/ring tokens ARE the orange, so focus:ring-ring is the
 * orange ring), payment tiles with a pale-blue selected fill
 * (#E3F0FA — this package's own selected tint) plus the orange
 * ring, and slot cards in the same family. Sizes keep the family
 * heights so the checkout's layout rhythm is unchanged.
 */
import type { CheckoutSkin } from "../slots";

export const CIRCUIT_CHECKOUT_SKIN: CheckoutSkin = {
  INPUT_CLASS:
    "h-12 w-full rounded-lg border border-input bg-card px-3.5 text-[15px] text-text-main shadow-sm outline-none transition placeholder:text-text-subtle focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-60",
  PAYMENT_TILE_CLASS:
    "flex min-h-[52px] cursor-pointer items-start gap-2.5 rounded-lg border border-input bg-card px-3 py-2.5 shadow-sm transition duration-200 has-[:checked]:border-primary has-[:checked]:bg-[#E3F0FA] dark:has-[:checked]:bg-card has-[:checked]:ring-2 has-[:checked]:ring-ring/40 hover:border-primary/50",
  SLOT_CARD_CLASS:
    "flex min-h-[52px] cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-2.5 text-left shadow-sm transition duration-200 has-[:checked]:border-primary has-[:checked]:bg-[#E3F0FA] dark:has-[:checked]:bg-card has-[:checked]:ring-2 has-[:checked]:ring-ring/40 hover:border-primary/50",
  // P4 surfaces (doc 32): section cards step the tech-frame radius
  // up one notch (rounded-xl), same border/shadow language; the
  // summary panel wears the package's pale-blue tint (#E3F0FA, the
  // selected-tile fill) in light mode — Circuit is supportsDark, so
  // dark:bg-card hands the panel back to the flipping card token
  // rather than leaving dark-flipped text on a fixed pale hex; CTAs
  // keep the platform brand-gradient at the family's rounded-lg;
  // the sticky bar keeps the platform geometry with a neutral
  // shadow.
  SECTION_CARD_CLASS:
    "rounded-xl border border-input bg-card p-5 shadow-sm",
  SUMMARY_PANEL_CLASS:
    "rounded-xl border border-input bg-[#E3F0FA] p-5 shadow-sm dark:bg-card",
  PRIMARY_CTA_CLASS:
    "brand-gradient h-12 w-full rounded-lg text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
  STICKY_BAR_CLASS:
    "fixed inset-x-0 bottom-16 z-40 border-t border-input bg-card/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden",
  STICKY_CTA_CLASS:
    "brand-gradient flex h-12 shrink-0 items-center gap-1.5 rounded-lg px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
};
