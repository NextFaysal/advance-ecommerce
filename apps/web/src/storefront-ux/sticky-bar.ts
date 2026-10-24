/**
 * Sticky add-to-cart bar state logic — Part B. Pure: the product page
 * measures its buy-box, feeds scroll metrics in, and renders the mobile
 * sticky bar only when this says visible. Keeping the decision pure means
 * the rule is testable without a browser.
 *
 * Rule: show the bar once the buy-box has scrolled fully above the
 * viewport top, hide it again when the page footer is on screen (so the
 * bar never fights the footer / checkout links), and never show it when
 * every variant is out of stock (a dead button helps no one).
 */

export interface StickyBarMetrics {
  /** Current window scroll offset (px). */
  scrollY: number;
  /** Buy-box bottom edge, in document coordinates (px). */
  buyBoxBottom: number;
  /** Footer top edge, in document coordinates (px). null = no footer measured. */
  footerTop: number | null;
  /** Viewport height (px). */
  viewportHeight: number;
  /** At least one active variant has stock. */
  inStock: boolean;
}

export type StickyBarState =
  | { visible: true }
  | { visible: false; reason: "buy_box_visible" | "footer_visible" | "out_of_stock" };

export function stickyBarState(m: StickyBarMetrics): StickyBarState {
  if (!m.inStock) return { visible: false, reason: "out_of_stock" };
  if (m.scrollY < m.buyBoxBottom) return { visible: false, reason: "buy_box_visible" };
  if (m.footerTop !== null && m.scrollY + m.viewportHeight >= m.footerTop) {
    return { visible: false, reason: "footer_visible" };
  }
  return { visible: true };
}
