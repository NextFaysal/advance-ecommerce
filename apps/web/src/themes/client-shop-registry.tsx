/**
 * Theme slot registry — CLIENT-safe ShopChrome (doc 25 §1.4; wave S3b).
 *
 * Kept as a sibling of client-slot-registry.tsx on purpose: the
 * Aurora ShopChrome composition pulls in the shop route's filter
 * drawer chain, and only ShopBrowser should pay that bundle cost.
 * Leaf consumers (ThemedProductCard on the home page) never import
 * this module.
 *
 * Fallback discipline matches the other registries (doc 25 §4.4):
 * per-slot Aurora fallback — unknown package or missing slot →
 * Aurora's component.
 */
import AuroraShopChrome from "./aurora/shop-chrome";
import BazaarShopChrome from "./bazaar/shop-chrome";
import { DEFAULT_PACKAGE_ID } from "./registry";
import type { ThemeShopChromeSlot } from "./slots";

/** Registered ShopChrome slots, by package id. Aurora is the fallback. */
const PACKAGE_SHOP_CHROME: ReadonlyMap<string, ThemeShopChromeSlot> = new Map([
  [DEFAULT_PACKAGE_ID, AuroraShopChrome],
  ["bazaar", BazaarShopChrome],
]);

/** Resolve the ShopChrome slot for a package (Aurora on any miss). */
export function getShopChromeSlot(
  packageId: string | null | undefined,
): ThemeShopChromeSlot {
  return (
    (packageId ? PACKAGE_SHOP_CHROME.get(packageId) : undefined) ??
    AuroraShopChrome
  );
}

/** Aurora's ShopChrome — composition roots use it as the
 *  ThemeBoundary fallback for the resolved slot. */
export const AURORA_SHOP_CHROME = AuroraShopChrome;
