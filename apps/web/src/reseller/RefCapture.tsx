"use client";

/**
 * ResellerRefCapture — Wave 6. Mounted by app/storefront-shell.tsx on
 * storefront routes only (the shell renders children bare on /admin and
 * /offline, so this never runs there).
 *
 * On every storefront navigation, a ?ref=CODE query param is captured
 * into localStorage (src/reseller/attribution.ts) with the capture
 * timestamp; the checkout page later reads it back — while it is inside
 * the 30-day window — and includes it in the order create payload, and
 * the server turns it into Order.resellerId.
 *
 * Reads window.location directly instead of useSearchParams so no
 * Suspense boundary is needed anywhere and SSR is untouched: this
 * component renders null and only acts in an effect after hydration.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { normalizeResellerCode, storeResellerRef } from "./attribution";

export default function ResellerRefCapture() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      const code = normalizeResellerCode(ref);
      if (code) storeResellerRef(code);
    } catch {
      // Attribution is best-effort — a capture failure must never
      // surface on a storefront page.
    }
  }, [pathname]);
  return null;
}
