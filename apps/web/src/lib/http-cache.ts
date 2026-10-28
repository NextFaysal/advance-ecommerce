/**
 * Cache-Control helpers for public read endpoints (speed wave,
 * 2026-10-26).
 *
 * Public catalog data (product lists, product detail, categories,
 * brands, site content) is identical for every visitor, so the CDN
 * may serve it from the edge: `s-maxage` seconds of freshness, then
 * stale-while-revalidate while one origin request refreshes it.
 * Prices/stock can therefore lag up to the s-maxage window — checkout
 * always re-validates price and stock against the live DB, so a
 * stale card can never sell at a wrong price or oversell.
 *
 * NEVER use these headers on account, cart, checkout, payment, admin
 * or any per-user response.
 */
export function catalogCacheHeaders(
  sMaxAgeSeconds = 60,
  staleWhileRevalidateSeconds = 300,
): Record<string, string> {
  return {
    "Cache-Control": `public, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`,
  };
}
