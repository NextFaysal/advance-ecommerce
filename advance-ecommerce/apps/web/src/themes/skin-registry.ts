/**
 * Checkout skin registry (doc 25 §1.4; wave S3b; deepened doc 32 P4).
 *
 * CheckoutSkin is DATA (class strings), not a component, so it gets
 * its own tiny registry instead of a place in the component maps: a
 * package registers a partial skin and every key it omits falls back
 * to Aurora's value for that key — the same per-slot Aurora fallback
 * discipline as the component registries (doc 25 §4.4), applied per
 * key. Resolution is total: getCheckoutSkin always returns a
 * ResolvedCheckoutSkin with all eight keys present (the original
 * three field/tile keys plus the five P4 surface keys).
 *
 * Import-free of components: safe for the client checkout page (its
 * only consumer today) and any future server consumer alike.
 */
import { AURORA_CHECKOUT_SKIN } from "./aurora/checkout-skin";
import { BAZAAR_CHECKOUT_SKIN } from "./bazaar/checkout-skin";
import { HAAT_CHECKOUT_SKIN } from "./haat/checkout-skin";
import { SHOBJI_CHECKOUT_SKIN } from "./shobji/checkout-skin";
import { BOIGHOR_CHECKOUT_SKIN } from "./boighor/checkout-skin";
import { CIRCUIT_CHECKOUT_SKIN } from "./circuit/checkout-skin";
import { NEEL_CHECKOUT_SKIN } from "./neel/checkout-skin";
import { DEFAULT_PACKAGE_ID } from "./registry";
import type { CheckoutSkin, ResolvedCheckoutSkin } from "./slots";

/** Registered skins, by package id. Aurora is the fallback. */
const PACKAGE_SKINS: ReadonlyMap<string, Partial<CheckoutSkin>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_CHECKOUT_SKIN],
  ["bazaar", BAZAAR_CHECKOUT_SKIN],
  ["haat", HAAT_CHECKOUT_SKIN],
  ["shobji", SHOBJI_CHECKOUT_SKIN],
  ["boighor", BOIGHOR_CHECKOUT_SKIN],
  ["circuit", CIRCUIT_CHECKOUT_SKIN],
  ["neel", NEEL_CHECKOUT_SKIN],
]);

/**
 * Resolve the checkout skin for a package. Unknown package → the
 * full Aurora skin; a package skin missing a key inherits Aurora's
 * value for that key. The result is fully resolved: Aurora's skin
 * defines all eight keys (its P4 surface values are the checkout
 * page's pre-P4 hardcoded strings, verbatim), so every key of the
 * returned ResolvedCheckoutSkin is a real string.
 */
export function getCheckoutSkin(
  packageId: string | null | undefined,
): ResolvedCheckoutSkin {
  const own = packageId ? PACKAGE_SKINS.get(packageId) : undefined;
  if (!own) return AURORA_CHECKOUT_SKIN;
  return {
    INPUT_CLASS: own.INPUT_CLASS ?? AURORA_CHECKOUT_SKIN.INPUT_CLASS,
    PAYMENT_TILE_CLASS:
      own.PAYMENT_TILE_CLASS ?? AURORA_CHECKOUT_SKIN.PAYMENT_TILE_CLASS,
    SLOT_CARD_CLASS: own.SLOT_CARD_CLASS ?? AURORA_CHECKOUT_SKIN.SLOT_CARD_CLASS,
    SECTION_CARD_CLASS:
      own.SECTION_CARD_CLASS ?? AURORA_CHECKOUT_SKIN.SECTION_CARD_CLASS,
    SUMMARY_PANEL_CLASS:
      own.SUMMARY_PANEL_CLASS ?? AURORA_CHECKOUT_SKIN.SUMMARY_PANEL_CLASS,
    PRIMARY_CTA_CLASS:
      own.PRIMARY_CTA_CLASS ?? AURORA_CHECKOUT_SKIN.PRIMARY_CTA_CLASS,
    STICKY_BAR_CLASS:
      own.STICKY_BAR_CLASS ?? AURORA_CHECKOUT_SKIN.STICKY_BAR_CLASS,
    STICKY_CTA_CLASS:
      own.STICKY_CTA_CLASS ?? AURORA_CHECKOUT_SKIN.STICKY_CTA_CLASS,
  };
}

/** Aurora's skin — exported for composition roots that need the
 *  fallback values directly. */
export { AURORA_CHECKOUT_SKIN };
