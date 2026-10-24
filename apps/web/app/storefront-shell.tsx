"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/storefront-shell";

// Storefront shell mount (integration for Agent 31): header + footer on
// storefront routes only — never on /admin or /offline. Later, brandName
// can be passed from public settings to both components.
const HIDDEN_PREFIXES = ["/admin", "/offline"];

export default function StorefrontShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hidden = HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p));
  if (hidden) return <>{children}</>;
  return (
    <>
      <SiteHeader />
      {children}
      <SiteFooter />
    </>
  );
}
