/**
 * Theme slot registry — CLIENT-safe side (doc 25 §1.4; waves S3a + S3b).
 *
 * The storefront shell (app/storefront-shell.tsx) is a client
 * component: it owns the pathname gating and the client-side
 * category/menu fetches, and renders Header + Footer. It resolves
 * the active package's shell slots through this module — a plain
 * static-import lookup keyed by the packageId from the ThemeView
 * context, exactly as doc 25 §1.4 prescribes ("client components
 * import the registry directly and index it by packageId"). No
 * component ever crosses the RSC boundary as a prop.
 *
 * Header/Footer live here, and (S3b) the CartDrawer: the shell mounts
 * it beside its other floating elements. Aurora's drawer is the
 * explicit NullCartDrawer (renders nothing — Theme #1 has no
 * drawer); a package with a real drawer registers it here and the
 * shell's mount point does not change. HomeSections/PdpComposition
 * render async server sections and cannot enter the client bundle,
 * so they are registered only in the server-side registry
 * (src/themes/slot-registry.tsx); ProductCard and ShopChrome have
 * their own client siblings (client-card-registry.ts,
 * client-shop-registry.ts) so leaf consumers never drag the shop
 * chrome or drawer chains into their bundles.
 *
 * Fallback discipline matches the server registry (doc 25 §4.4):
 * per-slot Aurora fallback — unknown package or missing slot →
 * Aurora's component for that slot.
 */
import { AURORA_SHELL_SLOTS } from "./aurora/shell-slots";
import { BAZAAR_SHELL_SLOTS } from "./bazaar/shell-slots";
import { HAAT_SHELL_SLOTS } from "./haat/shell-slots";
import { SHOBJI_SHELL_SLOTS } from "./shobji/shell-slots";
import { BOIGHOR_SHELL_SLOTS } from "./boighor/shell-slots";
import { CIRCUIT_SHELL_SLOTS } from "./circuit/shell-slots";
import { NEEL_SHELL_SLOTS } from "./neel/shell-slots";
import { NullCartDrawer } from "./aurora/cart-drawer";
import BazaarCartDrawer from "./bazaar/cart-drawer";
import HaatCartDrawer from "./haat/cart-drawer";
import ShobjiCartDrawer from "./shobji/cart-drawer";
import BoighorCartDrawer from "./boighor/cart-drawer";
import CircuitCartDrawer from "./circuit/cart-drawer";
import NeelCartDrawer from "./neel/cart-drawer";
import { DEFAULT_PACKAGE_ID } from "./registry";
import type { ThemeCartDrawerSlot, ThemeShellSlots } from "./slots";

/** Registered shell slot maps, by package id. Aurora is the fallback. */
const PACKAGE_SHELL_SLOTS: ReadonlyMap<string, Partial<ThemeShellSlots>> = new Map([
  [DEFAULT_PACKAGE_ID, AURORA_SHELL_SLOTS],
  ["bazaar", BAZAAR_SHELL_SLOTS],
  ["haat", HAAT_SHELL_SLOTS],
  ["shobji", SHOBJI_SHELL_SLOTS],
  ["boighor", BOIGHOR_SHELL_SLOTS],
  ["circuit", CIRCUIT_SHELL_SLOTS],
  ["neel", NEEL_SHELL_SLOTS],
]);

/**
 * Resolve the shell slots (Header/Footer) for a package, with
 * per-slot Aurora fallback.
 */
export function getShellSlots(packageId: string | null | undefined): ThemeShellSlots {
  const own = packageId ? PACKAGE_SHELL_SLOTS.get(packageId) : undefined;
  return {
    Header: own?.Header ?? AURORA_SHELL_SLOTS.Header,
    Footer: own?.Footer ?? AURORA_SHELL_SLOTS.Footer,
  };
}

/** Aurora's shell slots — the shell uses these as the ThemeBoundary
 *  fallback for the resolved Header/Footer. */
export { AURORA_SHELL_SLOTS };

/** Registered CartDrawer slots, by package id. Aurora is the fallback. */
const PACKAGE_CART_DRAWERS: ReadonlyMap<string, ThemeCartDrawerSlot> = new Map<string, ThemeCartDrawerSlot>([
  [DEFAULT_PACKAGE_ID, NullCartDrawer],
  ["bazaar", BazaarCartDrawer],
  ["haat", HaatCartDrawer],
  ["shobji", ShobjiCartDrawer],
  ["boighor", BoighorCartDrawer],
  ["circuit", CircuitCartDrawer],
  ["neel", NeelCartDrawer],
]);

/** Resolve the CartDrawer slot for a package (Aurora on any miss). */
export function getCartDrawerSlot(
  packageId: string | null | undefined,
): ThemeCartDrawerSlot {
  return (
    (packageId ? PACKAGE_CART_DRAWERS.get(packageId) : undefined) ??
    NullCartDrawer
  );
}

/** Aurora's CartDrawer — the explicit null drawer (renders nothing). */
export const AURORA_CART_DRAWER = NullCartDrawer;
