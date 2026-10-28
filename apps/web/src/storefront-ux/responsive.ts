/**
 * Responsive contract — the class-string half (doc 33 §3).
 *
 * Doc 33 turns the mobile-first rules into named constants so the
 * seven theme packages consume ONE contract instead of re-deriving
 * it per file (the drift doc 32 removed from the single pages). The
 * CSS half — safe-area utilities (.pb-safe / .pb-safe-floor), the
 * rail fade (.rail-fade-x) and the left-drawer entry animation —
 * lives in app/globals.css; the `xs` = 420px named-exception screen
 * lives in tailwind.config.js (§3.1).
 *
 * Rules these constants encode:
 * - §3.1 Breakpoints are Tailwind defaults; base classes describe
 *   the PHONE layout (design target 360–430px), prefixes only add
 *   room. The single named exception is `xs` (420px).
 * - §3.2 One page edge everywhere: max-w-[1440px] with the
 *   px-4 → sm:px-6 → lg:px-8 rhythm.
 * - §3.3 Sticky budget: at most ~112px of stuck chrome on phone —
 *   only a header's main tier may carry `sticky` below `lg`.
 * - §3.4 Safe-area is mandatory on fixed elements (use the
 *   globals.css utilities / SAFE_AREA_BAR_CLASS below).
 * - §3.5 Floors: touch targets ≥44px; readable labels ≥12px (11px
 *   only for badges/counts/icon-paired micro-labels); prices ≥14px.
 */

/** §3.2 — the one page edge: centred 1440px column + padding rhythm.
 *  Compose with a width/padding-free wrapper; PageShell's wide/full
 *  variants (PageKit) carry the same values for platform pages. */
export const PAGE_EDGE_CLASS = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";

/** §3.3 — the sticky budget on phone, in px. A header wave proves
 *  compliance by measuring its stuck tiers against this number; it
 *  is a budget, not a height — tiers size themselves under it. */
export const STICKY_BUDGET_PX = 112;

/** §3.1 — the named exception breakpoint (tailwind `xs`), in px.
 *  Absorbs the pre-contract `min-[420px]:` arbitrary values; new
 *  code uses the `xs:` variant, never the arbitrary form. */
export const XS_EXCEPTION_PX = 420;

/** §3.4 — the StickyBuyBar safe-area formula as a reusable class
 *  string (identical geometry to the .pb-safe-floor utility in
 *  globals.css; this constant exists for surfaces that compose
 *  their padding in TSX class strings). */
export const SAFE_AREA_BAR_CLASS = "pb-[max(0.75rem,env(safe-area-inset-bottom))]";

/** §3.5 — the touch floor as a class string: any interactive
 *  element wearing this meets the ≥44px rule in both dimensions. */
export const TOUCH_FLOOR_CLASS = "min-h-[44px] min-w-[44px]";

/** §3.5 — the rail affordance: apply to a horizontal scroll rail
 *  (alongside `overflow-x-auto` + snap classes) so its right edge
 *  fades and the scrollability is visible. Utility in globals.css. */
export const RAIL_FADE_CLASS = "rail-fade-x";
