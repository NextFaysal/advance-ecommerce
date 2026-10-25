// Cart persistence — guest cart in localStorage (the only storefront cart).
// This module is browser-guarded: it returns null / no-ops during SSR.
// The old /api/v1/public/carts stub route was removed (wave 5); accounts do
// not have a server cart — orders attach to the customer by phone on checkout.
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
 * Merge helper kept for a future server cart: merges the guest cart into a
 * user cart supplied by the caller, then clears the guest cart.
 * `fetchUserCart` / `saveUserCart` are injected; no endpoint exists today.
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
