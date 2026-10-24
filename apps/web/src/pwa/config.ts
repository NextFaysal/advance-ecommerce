/**
 * PWA constants — Agent 12 (Step 30 base).
 * Single source of truth for the manifest, service worker caches and
 * the offline shell. Keep values in sync with:
 *  - apps/web/public/manifest.webmanifest
 *  - apps/web/public/sw.js (plain JS, cannot import this file)
 */

export const PWA_APP_NAME = "Advance Ecommerce";
export const PWA_SHORT_NAME = "AdvEcommerce";
export const PWA_DESCRIPTION =
  "Bangladesh-first ecommerce — storefront and admin. Bangla (bn) default, BDT.";
export const PWA_LANG = "bn";
/** Design token brand-600 / neutral bg from the design system. */
export const PWA_THEME_COLOR = "#4F46E5";
export const PWA_BACKGROUND_COLOR = "#F8F9FD";

export const PWA_START_URL = "/";
export const PWA_SCOPE = "/";
export const PWA_DISPLAY = "standalone" as const;

export const SERVICE_WORKER_PATH = "/sw.js";
export const OFFLINE_URL = "/offline";

/**
 * Icon paths are PLACEHOLDERS: the PNG files do not exist in the repo
 * yet. A designer/icon step must drop real 192/512 (and maskable 512)
 * PNGs at these exact paths before the PWA is installable in Chrome —
 * until then the manifest validates but install prompts may not fire.
 */
export const PWA_ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const;

export const PWA_SHORTCUTS = [
  { name: "New Order", shortName: "New Order", url: "/admin/orders?action=new" },
  { name: "Orders", shortName: "Orders", url: "/admin/orders" },
  { name: "Scan", shortName: "Scan", url: "/admin/scan" },
] as const;

/** Bump CACHE_VERSION whenever the offline shell changes. */
export const CACHE_VERSION = "v3";
export const STATIC_CACHE = `advance-ecommerce-static-${CACHE_VERSION}`;
export const PAGE_CACHE = `advance-ecommerce-pages-${CACHE_VERSION}`;

/** URLs precached at SW install: the offline shell only. */
export const PRECACHE_URLS: readonly string[] = [OFFLINE_URL, "/manifest.webmanifest"];

/** Path prefixes that must NEVER be cached: all API + auth routes. */
export const NEVER_CACHE_PREFIXES: readonly string[] = ["/api/", "/admin/login"];
