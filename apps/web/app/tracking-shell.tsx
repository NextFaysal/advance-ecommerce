"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ConsentBanner, TrackingProvider } from "@/tracking/client-components";

// Storefront tracking shell (integration mount for Agent 26 + Multi-Pixel & Clarity).
// Reads configured public IDs (or NEXT_PUBLIC env fallbacks) for browser-side tracking.
// Access tokens are NEVER passed here; they remain server-only.
export default function TrackingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin") ?? false;
  if (isAdmin) return <>{children}</>;

  const primaryPixel = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? null;
  const backupPixel = process.env.NEXT_PUBLIC_META_BACKUP_PIXEL_ID ?? null;
  const clarityId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? null;

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
