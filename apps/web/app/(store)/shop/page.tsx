import type { Metadata } from "next";
import { Suspense } from "react";
import { ShopBrowser } from "./ShopBrowser";

// Wave 47 (shop speed): /shop used to render per-request on the server
// from searchParams (force-dynamic — 8.2s TTFB in production while the
// ISR homepage/PDP sit at ~1s). It is now a STATIC shell: this page
// does no data fetching and reads no searchParams; the client
// ShopBrowser owns the whole filter/sort/search UI and reads the
// edge-cached public APIs (products / categories / brands /
// catalog/attribute-sets). The URL param contract is unchanged
// (category, brand, sort, min, max, instock, q, rating, attr) —
// shareable filter links keep working, now via soft navigation.
//
// Honest trade-off: the old searchParams-driven generateMetadata gave
// category landings (/shop?category=<slug>) server-rendered SEO
// title/description from the category's SEO fields. A static shell
// cannot do that per-URL, so category landings now carry the generic
// shop metadata in the served HTML and ShopBrowser updates
// document.title client-side from the same SEO fields once the
// categories payload lands. Social/SEO crawlers that don't run JS
// will see the generic shop title for category URLs.
const SHOP_DEFAULT_TITLE = "দোকান — Advance Ecommerce";
const SHOP_DEFAULT_DESCRIPTION = "সব পণ্য — ফিল্টার, সর্ট ও সার্চ দিয়ে খুঁজুন।";

export const metadata: Metadata = {
  title: SHOP_DEFAULT_TITLE,
  description: SHOP_DEFAULT_DESCRIPTION,
};

// The shell itself never changes; a long revalidate keeps it a pure
// edge-served static page (all live data arrives via the cached APIs).
export const revalidate = 300;

export default function ShopPage() {
  return (
    <Suspense fallback={null}>
      <ShopBrowser />
    </Suspense>
  );
}
