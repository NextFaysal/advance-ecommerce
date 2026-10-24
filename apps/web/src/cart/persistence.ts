// Cart persistence — guest cart in localStorage, user cart on the server (to be wired).
// This module is browser-guarded: it returns null / no-ops during SSR.
// Real server persistence (carts + cart_items tables, see orders/SCHEMA-ADDITIONS.md)
// is a follow-up for the API/DB owner; this file must not invent an API endpoint.
import type { Cart } from "./types";

export const GUEST_CART_KEY = "advance-ecommerce-guest-cart";

export function loadGuestCart(): Cart | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(GUEST_CART_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cart;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveGuestCart(cart: Cart): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify(cart));
  } catch {
    // Storage full / private mode: cart stays in memory for this session.
  }
}

export function clearGuestCart(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(GUEST_CART_KEY);
}

/**
 * On login: merge the guest cart into the user's server cart, then clear the
 * guest cart. `fetchUserCart` / `saveUserCart` are injected so this module
 * stays endpoint-agnostic until the API owner wires /api/v1/public/carts.
 */
export async function mergeGuestCartOnLogin(
  guest: Cart,
  fetchUserCart: () => Promise<Cart>,
  saveUserCart: (cart: Cart) => Promise<void>,
): Promise<Cart> {
  const { mergeGuestIntoUserCart } = await import("./types");
  const userCart = await fetchUserCart();
  const merged = mergeGuestIntoUserCart(guest, userCart);
  await saveUserCart(merged);
  clearGuestCart();
  return merged;
}
