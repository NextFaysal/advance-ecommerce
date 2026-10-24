"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ConsentBanner, TrackingProvider } from "@/tracking/client-components";

// Storefront tracking shell (integration mount for Agent 26).
// pixelId is null until a public pixel id is configured in Admin > Settings
// (tracking) — the client then runs in explicit no-op mode. Access tokens
// are NEVER passed here; they are server-only.
export default function TrackingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin") ?? false;
  if (isAdmin) return <>{children}</>;
  return (
    <TrackingProvider pixelId={null} pathname={pathname}>
      {children}
      <ConsentBanner privacyHref="/privacy" />
    </TrackingProvider>
  );
}
