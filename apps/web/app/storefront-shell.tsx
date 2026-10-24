"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/storefront-shell";

// Storefront shell mount (integration for Agent 31): header + footer on
// storefront routes only — never on /admin or /offline. Later, brandName
// can be passed from public settings to both components.
// Design refresh: the header renders a fixed mobile bottom nav, so page
// content gets bottom padding on small screens to keep the footer
// reachable — except on /product/*, where the PDP sticky buy bar owns
// the bottom edge and the nav is hidden (see SiteHeader).
const HIDDEN_PREFIXES = ["/admin", "/offline"];

export default function StorefrontShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hidden = HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p));
  if (hidden) return <>{children}</>;
  const isProductPage = pathname?.startsWith("/product/") ?? false;
  return (
    <div className={isProductPage ? undefined : "pb-16 lg:pb-0"}>
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
