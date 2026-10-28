/**
 * Theme slot registry — CLIENT-safe ShopChrome (doc 25 §1.4; wave S3b;
 * per-theme code split, perf wave item 5).
 *
 * Kept as a sibling of client-slot-registry.tsx on purpose: the
 * Aurora ShopChrome composition pulls in the shop route's filter
 * drawer chain, and only ShopBrowser should pay that bundle cost.
 * Leaf consumers (ThemedProductCard on the home page) never import
 * this module.
 *
 * PER-THEME CODE SPLIT (perf wave item 5): the non-Aurora chromes
 * now load through next/dynamic keyed by package — one chunk per
 * theme, only the ACTIVE theme's chrome downloads with /shop. SSR
 * is unchanged (dynamic's default ssr path): ShopBrowser is part of
 * the server-rendered /shop page, the active theme's chrome
 * server-renders exactly as before and its chunk preloads with the
 * page. Aurora's chrome stays STATIC: it is the fallback slot
 * (doc 25 §4.4) and the ThemeBoundary fallback, so it must never
 * itself be a lazy load. The dynamic components are created once at
 * module scope so each package keeps a stable component identity
 * across ShopBrowser's renders.
 *
 * Fallback discipline matches the other registries (doc 25 §4.4):
 * per-slot Aurora fallback — unknown package or missing slot →
 * Aurora's component.
 */
import dynamic from "next/dynamic";
import AuroraShopChrome from "./aurora/shop-chrome";
import { DEFAULT_PACKAGE_ID } from "./registry";
import type { ThemeShopChromeSlot } from "./slots";

const BazaarShopChrome = dynamic(() => import("./bazaar/shop-chrome"));
const HaatShopChrome = dynamic(() => import("./haat/shop-chrome"));
const ShobjiShopChrome = dynamic(() => import("./shobji/shop-chrome"));
const BoighorShopChrome = dynamic(() => import("./boighor/shop-chrome"));
const CircuitShopChrome = dynamic(() => import("./circuit/shop-chrome"));
const NeelShopChrome = dynamic(() => import("./neel/shop-chrome"));

/** Registered ShopChrome slots, by package id. Aurora is the fallback. */
const PACKAGE_SHOP_CHROME: ReadonlyMap<string, ThemeShopChromeSlot> = new Map<string, ThemeShopChromeSlot>([
  [DEFAULT_PACKAGE_ID, AuroraShopChrome],
  ["bazaar", BazaarShopChrome],
  ["haat", HaatShopChrome],
  ["shobji", ShobjiShopChrome],
  ["boighor", BoighorShopChrome],
  ["circuit", CircuitShopChrome],
  ["neel", NeelShopChrome],
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
