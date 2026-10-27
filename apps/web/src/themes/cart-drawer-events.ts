/**
 * Cart-drawer open signal (doc 25 wave S4a).
 *
 * The storefront shell (app/storefront-shell.tsx) owns the
 * CartDrawer slot's open state; theme packages render deep inside
 * the shell (header, product cards) and cannot reach that state
 * without threading props through platform components. So "open the
 * drawer" is a window event — the same pattern the cart itself
 * already uses (CART_UPDATED_EVENT in AddToCartButton.tsx):
 *
 * - `openCartDrawer()` — called by a package's header cart action
 *   or after a successful add-to-cart in a drawer-owning theme.
 * - `subscribeCartDrawerOpen(cb)` — the shell subscribes once and
 *   sets its state; returns the unsubscribe function.
 *
 * Aurora never dispatches the event (its header links to /cart and
 * its drawer slot is the null component), so wiring the listener
 * into the shell changes nothing for Theme #1.
 */

export const CART_DRAWER_OPEN_EVENT = "ae:open-cart-drawer";

/** Ask the shell to open the active package's cart drawer. */
export function openCartDrawer(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CART_DRAWER_OPEN_EVENT));
}

/** Subscribe to drawer-open requests. Returns an unsubscribe fn. */
export function subscribeCartDrawerOpen(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(CART_DRAWER_OPEN_EVENT, handler);
  return () => window.removeEventListener(CART_DRAWER_OPEN_EVENT, handler);
}
