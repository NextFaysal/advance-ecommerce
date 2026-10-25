"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/storefront-shell";
import type { PublicCategoryNode } from "@/catalog/category-tree";
import type {
  FooterMenuGroup,
  SiteContentConfigured,
  SiteMenuItem,
} from "@/cms/site-content-types";
import InstallPrompt from "@/pwa/install-prompt";
import ResellerRefCapture from "@/reseller/RefCapture";

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
// and passed into SiteHeader for the mega menu. Since Wave 13-2 the
// API returns the category TREE (roots with nested `children`), which
// the mega menu renders as grouped sub-categories. This shell is a client
// component (it needs usePathname), and the middleware only sets
// x-pathname for /admin + /dashboard, so a server-side pathname read
// here would break the /product/* bottom-nav rule — the fetch stays
// client-side against the public API. Until it resolves, `categories`
// stays undefined and SiteHeader shows its loading state (the header
// row itself always renders; no fake categories are ever invented).
const HIDDEN_PREFIXES = ["/admin", "/offline"];

interface SiteContentResponse {
  headerMenu: SiteMenuItem[];
  footerMenu: FooterMenuGroup[];
  configured: SiteContentConfigured;
}

export default function StorefrontShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [categories, setCategories] = useState<ReadonlyArray<PublicCategoryNode> | undefined>(undefined);
  const [siteContent, setSiteContent] = useState<SiteContentResponse | undefined>(undefined);

  useEffect(() => {
    let live = true;
    fetch("/api/v1/public/categories")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data?: unknown } | null) => {
        if (live && json && Array.isArray(json.data)) {
          setCategories(json.data as PublicCategoryNode[]);
        }
      })
      .catch(() => {
        // Mega menu stays hidden — never block the shell on this fetch.
      });
    return () => {
      live = false;
    };
  }, []);

  // CMS site content (Admin → Content): header/footer menus saved by
  // the owner. Menus are passed down ONLY for sections the owner has
  // actually configured (API meta.configured) — until then the header
  // and footer render their built-in defaults, which are identical to
  // the API's default payload, so nothing shifts when this resolves.
  useEffect(() => {
    let live = true;
    fetch("/api/v1/public/site-content")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data?: SiteContentResponse; meta?: { configured?: SiteContentConfigured } } | null) => {
        if (live && json?.data && json.meta?.configured) {
          setSiteContent({ ...json.data, configured: json.meta.configured });
        }
      })
      .catch(() => {
        // Built-in default menus stay — never block the shell on this.
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
      <SiteHeader
        categories={categories}
        headerMenu={siteContent?.configured.headerMenu ? siteContent.headerMenu : undefined}
      />
      {children}
      <SiteFooter
        footerMenu={siteContent?.configured.footerMenu ? siteContent.footerMenu : undefined}
      />
      <InstallPrompt />
      {/* Reseller attribution (wave 6): captures ?ref=CODE into
          localStorage on any storefront page; renders nothing. Only
          mounted in this storefront branch — never on /admin. */}
      <ResellerRefCapture />
    </div>
  );
}
