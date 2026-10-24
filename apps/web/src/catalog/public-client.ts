// Client-side catalog reads — DB swap follow-up, 2026-10-24.
// Browser components (wishlist, compare, recently-viewed) hold only
// product IDS in localStorage; the details resolve through the EXISTING
// public products API (ACTIVE-only, cost price stripped server-side).
// No mock data and no direct DB access from the client. The list is
// cached per page load: these surfaces re-resolve on navigation, and a
// product deactivated mid-session disappears on the next page load —
// the same honesty rule as the server read path.

import type { PublicProduct } from "./types";

let listCache: Promise<PublicProduct[]> | null = null;

export function fetchPublicProducts(): Promise<PublicProduct[]> {
  listCache ??= fetch("/api/v1/public/products?pageSize=100")
    .then((res) => (res.ok ? res.json() : { data: [] }))
    .then((json: { data?: PublicProduct[] }) => json.data ?? [])
    .catch(() => []);
  return listCache;
}

export async function fetchPublicProductBySlug(slug: string): Promise<PublicProduct | null> {
  try {
    const res = await fetch(`/api/v1/public/products/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: PublicProduct };
    return json.data ?? null;
  } catch {
    return null;
  }
}
