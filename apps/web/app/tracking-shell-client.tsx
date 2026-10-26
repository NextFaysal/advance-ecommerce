"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ConsentBanner, TrackingProvider } from "@/tracking/client-components";

// Client half of the storefront tracking shell. The public ids arrive as
// props from the server shell (app/tracking-shell.tsx), which resolves
// them DB-first (Admin Settings `seo.*`) with env fallback — see
// src/tracking/resolve.ts. Access tokens are NEVER passed here; they
// remain server-only.
export default function TrackingShellClient({
  primaryPixel,
  backupPixel,
  clarityId,
  children,
}: {
  primaryPixel: string | null;
  backupPixel: string | null;
  clarityId: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin") ?? false;
  if (isAdmin) return <>{children}</>;

  const pixelIds = [primaryPixel, backupPixel].filter(Boolean) as string[];

  return (
    <TrackingProvider
      pixelId={primaryPixel}
      pixelIds={pixelIds.length > 0 ? pixelIds : null}
      clarityProjectId={clarityId}
      pathname={pathname}
    >
      {children}
      <ConsentBanner privacyHref="/privacy" />
    </TrackingProvider>
  );
}
