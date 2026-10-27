/**
 * Checkout skin registry (doc 25 §1.4; wave S3b).
 *
 * CheckoutSkin is DATA (three class strings), not a component, so it
 * gets its own tiny registry instead of a place in the component
 * maps: a package registers a partial skin and every key it omits
 * falls back to Aurora's value for that key — the same per-slot
 * Aurora fallback discipline as the component registries (doc 25
 * §4.4), applied per key.
 *
 * Import-free of components: safe for the client checkout page (its
 * only consumer today) and any future server consumer alike.
 */
import { AURORA_CHECKOUT_SKIN } from "./aurora/checkout-skin";
import { BAZAAR_CHECKOUT_SKIN } from "./bazaar/checkout-skin";
import { DEFAULT_PACKAGE_ID } from "./registry";
import type { CheckoutSkin } from "./slots";

/** Registered skins, by package id. Aurora is the fallback. */
const PACKAGE_SKINS: ReadonlyMap<string, Partial<CheckoutSkin>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_CHECKOUT_SKIN],
  ["bazaar", BAZAAR_CHECKOUT_SKIN],
]);

/**
 * Resolve the checkout skin for a package. Unknown package → the
 * full Aurora skin; a package skin missing a key inherits Aurora's
 * value for that key.
 */
export function getCheckoutSkin(packageId: string | null | undefined): CheckoutSkin {
  const own = packageId ? PACKAGE_SKINS.get(packageId) : undefined;
  if (!own) return AURORA_CHECKOUT_SKIN;
  return {
    INPUT_CLASS: own.INPUT_CLASS ?? AURORA_CHECKOUT_SKIN.INPUT_CLASS,
    PAYMENT_TILE_CLASS:
      own.PAYMENT_TILE_CLASS ?? AURORA_CHECKOUT_SKIN.PAYMENT_TILE_CLASS,
    SLOT_CARD_CLASS: own.SLOT_CARD_CLASS ?? AURORA_CHECKOUT_SKIN.SLOT_CARD_CLASS,
  };
}

/** Aurora's skin — exported for composition roots that need the
 *  fallback values directly. */
export { AURORA_CHECKOUT_SKIN };
