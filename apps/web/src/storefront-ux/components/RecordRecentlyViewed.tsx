"use client";

/**
 * Records the current product into the browser-local recently-viewed
 * list on mount (src/storefront-ux/recently-viewed.ts). Renders nothing.
 */
import { useEffect } from "react";
import { recordRecentlyViewed } from "../recently-viewed";
import type { RecentlyViewedEntry } from "../types";

export function RecordRecentlyViewed({ entry }: { entry: RecentlyViewedEntry }) {
  const { productId } = entry;
  useEffect(() => {
    recordRecentlyViewed(entry);
    // Re-record only when a different product page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  return null;
}
