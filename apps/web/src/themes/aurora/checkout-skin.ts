/**
 * Aurora CheckoutSkin — doc 25 §1.4 / wave S3b; surfaces doc 32 P4.
 *
 * The checkout page's styling constants, with their values copied
 * verbatim from app/(store)/checkout/page.tsx (where the original
 * three lived as page-local constants before S3b, and where the five
 * P4 surface strings were hardcoded until P4). The checkout page
 * consumes them from the resolved skin; for Aurora the strings —
 * and therefore every rendered class — are identical to before.
 *
 * Aurora's skin is typed ResolvedCheckoutSkin (all eight keys):
 * it is the registry's per-key fallback for every other package,
 * so its completeness is a compile-time guarantee, not a hope.
 *
 * Data only (plain strings): safe in any bundle, and the exact
 * values a future package's skin overrides key-by-key.
 */
import type { ResolvedCheckoutSkin } from "../slots";

export const AURORA_CHECKOUT_SKIN: ResolvedCheckoutSkin = {
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
  // P4 surface tokens — the strings below are the checkout page's
  // pre-P4 hardcoded surfaces, verbatim (zero visual delta). The
  // summary value is surface only: the page appends its sticky-rail
  // positioning classes (lg:sticky lg:top-6 …) itself.
  SECTION_CARD_CLASS:
    "rounded-2xl border border-border bg-card p-5 shadow-card",
  SUMMARY_PANEL_CLASS:
    "rounded-2xl border border-border bg-card p-5 shadow-card",
  PRIMARY_CTA_CLASS:
    "brand-gradient h-12 w-full rounded-xl text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
  STICKY_BAR_CLASS:
    "fixed inset-x-0 bottom-16 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_16px_rgba(49,46,129,0.08)] backdrop-blur lg:hidden",
  STICKY_CTA_CLASS:
    "brand-gradient flex h-12 shrink-0 items-center gap-1.5 rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
};
