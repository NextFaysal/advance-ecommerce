"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AURORA_CART_DRAWER,
  AURORA_SHELL_SLOTS,
  getCartDrawerSlot,
  getShellSlots,
} from "@/themes/client-slot-registry";
import { ThemeBoundary } from "@/themes/theme-boundary";
import { useThemeView } from "@/themes/theme-view";
import { DEFAULT_PACKAGE_ID } from "@/themes/registry";
import { subscribeCartDrawerOpen } from "@/themes/cart-drawer-events";
import type { PublicCategoryNode } from "@/catalog/category-tree";
import type {
  FooterMenuGroup,
  SiteContentConfigured,
  SiteMenuItem,
} from "@/cms/site-content-types";
import InstallPrompt from "@/pwa/install-prompt";
import ResellerRefCapture from "@/reseller/RefCapture";
import dynamic from "next/dynamic";

// Exit-intent popup, lazy-mounted (perf wave, audit item 2): it is
// never visible at first paint — it self-gates on its public config
// fetch and only fires on a desktop exit gesture or a 60s touch
// dwell — so its code splits out of the shell's First Load chunk and
// loads with hydration, long before either trigger can occur. All
// trigger/suppression logic stays inside the component, untouched.
const ExitIntentPopup = dynamic(
  () => import("@/marketing/components/ExitIntentPopup").then((m) => m.ExitIntentPopup),
  { ssr: false },
);

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
  // Theme slots (S3a): Header/Footer are resolved from the active
  // package (ThemeView context, mounted server-side by ThemeShell)
  // through the client-safe slot registry — a static-import lookup,
  // never a component passed across the RSC boundary. Per-slot
  // Aurora fallback is built into the registry, and each slot is
  // additionally wrapped in a ThemeBoundary whose fallback is the
  // Aurora slot with the same props, so a throwing theme header or
  // footer degrades to Aurora instead of breaking the page.
  const themeView = useThemeView();
  const slots = getShellSlots(themeView.packageId);
  const Header = slots.Header;
  const Footer = slots.Footer;
  const AuroraHeader = AURORA_SHELL_SLOTS.Header;
  const AuroraFooter = AURORA_SHELL_SLOTS.Footer;
  // CartDrawer slot (S3b): mounted beside the other floating
  // elements with the shell owning its open state. Aurora's drawer
  // is the explicit NullCartDrawer (Theme #1 has no drawer; the
  // header cart links to /cart). Packages with a real drawer (S4a+)
  // open it via the cart-drawer-events subscription below.
  const CartDrawer = getCartDrawerSlot(themeView.packageId);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

  // Drawer-open requests (S4a): packages that own a drawer ask for
  // it through the cart-drawer-events window event (their header
  // cart action / post-add tap) because they render deep inside the
  // shell and cannot reach this state directly. Aurora never
  // dispatches the event, so this listener is a no-op under Theme
  // #1 — opening state only ever flips for a package whose drawer
  // slot exists to receive it.
  useEffect(() => subscribeCartDrawerOpen(() => setCartDrawerOpen(true)), []);
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
  // Mobile bottom padding (S4b): the pb-16 exists only to clear
  // Aurora's fixed mobile bottom nav. Packages without a bottom
  // nav (Bazaar) must not inherit the empty space, so the padding
  // applies only when the resolved package is the default one.
  // Aurora behaviour is byte-identical (product pages already
  // skipped it; other packages now skip it too).
  const hasMobileBottomNav = themeView.packageId === DEFAULT_PACKAGE_ID;
  const headerProps = {
    categories,
    headerMenu: siteContent?.configured.headerMenu ? siteContent.headerMenu : undefined,
  };
  const footerProps = {
    footerMenu: siteContent?.configured.footerMenu ? siteContent.footerMenu : undefined,
  };
  return (
    <div className={isProductPage || !hasMobileBottomNav ? undefined : "pb-16 lg:pb-0"}>
      <ThemeBoundary
        slotName="Header"
        packageId={themeView.packageId}
        fallback={<AuroraHeader {...headerProps} />}
      >
        <Header {...headerProps} />
      </ThemeBoundary>
      {children}
      <ThemeBoundary
        slotName="Footer"
        packageId={themeView.packageId}
        fallback={<AuroraFooter {...footerProps} />}
      >
        <Footer {...footerProps} />
      </ThemeBoundary>
      <InstallPrompt />
      {/* CartDrawer slot (S3b): the active package's slide-in cart.
          Aurora's NullCartDrawer renders nothing, so this mount is
          invisible today; the boundary fallback is the same Aurora
          drawer with the same props. */}
      <ThemeBoundary
        slotName="CartDrawer"
        packageId={themeView.packageId}
        fallback={
          <AURORA_CART_DRAWER open={cartDrawerOpen} onClose={() => setCartDrawerOpen(false)} />
        }
      >
        <CartDrawer open={cartDrawerOpen} onClose={() => setCartDrawerOpen(false)} />
      </ThemeBoundary>
      {/* Reseller attribution (wave 6): captures ?ref=CODE into
          localStorage on any storefront page; renders nothing. Only
          mounted in this storefront branch — never on /admin. */}
      <ResellerRefCapture />
      {/* Exit-intent popup (ADV-18 remainder): self-gating — renders
          nothing unless the public config endpoint returns an
          enabled config; suppression + page exclusions live inside.
          Lazy-loaded via next/dynamic above (audit item 2). */}
      <ExitIntentPopup />
    </div>
  );
}
