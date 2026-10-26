"use client";

// Visitor-id bootstrap for A/B assignment (ADV-18B). The homepage
// hero experiment keys assignment on the `ae_vid` cookie; RSC pages
// can read but not set cookies, so this tiny client component mints
// the id on first visit (1 year, SameSite=Lax). A first-ever
// pageview renders the default hero and is not counted as an
// exposure — assignment starts from the second pageview, which
// keeps the exposure counts honest.
import { useEffect } from "react";

const COOKIE = "ae_vid";

export function VisitorIdBootstrap() {
  useEffect(() => {
    if (document.cookie.split("; ").some((c) => c.startsWith(`${COOKIE}=`))) return;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `v-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    document.cookie = `${COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);
  return null;
}
