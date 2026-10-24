"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/storefront-shell";
import type { Category } from "@/catalog/types";
import InstallPrompt from "@/pwa/install-prompt";

// Storefront shell mount (integration for Agent 31): header + footer on
// storefront routes only — never on /admin or /offline. Later, brandName
// can be passed from public settings to both components.
// Design refresh: the header renders a fixed mobile bottom nav, so page
// content gets bottom padding on small screens to keep the footer
// reachable — except on /product/*, where the PDP sticky buy bar owns
// the bottom edge and the nav is hidden (see SiteHeader).
//
// Design v3 (§4 mega menu): categories are loaded from the EXISTING
// public categories API (GET /api/v1/public/categories — force-dynamic,
// the same repository data path the shop/home pages read server-side)
// and passed into SiteHeader for the mega menu. This shell is a client
// component (it needs usePathname), and the middleware only sets
// x-pathname for /admin + /dashboard, so a server-side pathname read
// here would break the /product/* bottom-nav rule — the fetch stays
// client-side against the public API. Until it resolves, `categories`
// stays undefined and SiteHeader shows its loading state (the header
// row itself always renders; no fake categories are ever invented).
const HIDDEN_PREFIXES = ["/admin", "/offline"];

export default function StorefrontShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [categories, setCategories] = useState<ReadonlyArray<Category> | undefined>(undefined);

  useEffect(() => {
    let live = true;
    fetch("/api/v1/public/categories")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data?: unknown } | null) => {
        if (live && json && Array.isArray(json.data)) {
          setCategories(json.data as Category[]);
        }
      })
      .catch(() => {
        // Mega menu stays hidden — never block the shell on this fetch.
      });
    return () => {
      live = false;
    };
  }, []);

  const hidden = HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p));
  if (hidden) return <>{children}</>;
  const isProductPage = pathname?.startsWith("/product/") ?? false;
  return (
    <div className={isProductPage ? undefined : "pb-16 lg:pb-0"}>
      <SiteHeader categories={categories} />
      {children}
      <SiteFooter />
      <InstallPrompt />
    </div>
  );
}
