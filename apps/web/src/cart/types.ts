// Cart types — Agent 4 (Checkout, Orders & CRM).
// Money is ALWAYS integer poisha. Never float. Prices come from the server;
// the client price is display-only and is re-validated server-side (see checkout/pricing.ts).

export type CartItem = {
  variantId: string;
  productId: string;
  name: string;
  /** Snapshot of the name/SKU at add time; server re-validates on checkout. */
  sku: string;
  /** Unit price in integer poisha. */
  unitPricePoisha: number;
  quantity: number;
  /** Stock available at last check; checkout re-checks live stock. */
  availableStock: number;
  imageUrl?: string;
};

export type Cart = {
  /** Guest cart id (cookie/device) or user id once logged in. */
  ownerKey: string;
  ownerType: "guest" | "user";
  items: CartItem[];
  couponCode?: string;
  updatedAt: string;
};

export function cartSubtotalPoisha(cart: Cart): number {
  return cart.items.reduce(
    (sum, item) => sum + item.unitPricePoisha * item.quantity,
    0,
  );
}

export function cartItemCount(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** Pure merge: guest cart into the user's cart. Same variant -> quantities add. */
export function mergeGuestIntoUserCart(guest: Cart, user: Cart): Cart {
  const byVariant = new Map<string, CartItem>();
  for (const item of user.items) byVariant.set(item.variantId, { ...item });
  for (const item of guest.items) {
    const existing = byVariant.get(item.variantId);
    if (existing) {
      byVariant.set(item.variantId, {
        ...existing,
        quantity: existing.quantity + item.quantity,
        // Keep the user's snapshot; price is re-validated server-side anyway.
        unitPricePoisha: existing.unitPricePoisha,
      });
    } else {
      byVariant.set(item.variantId, { ...item });
    }
  }
  return {
    ...user,
    ownerType: "user",
    items: [...byVariant.values()],
    updatedAt: new Date().toISOString(),
  };
}
