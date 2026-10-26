import type { ReactNode } from "react";
import { resolvePublicTrackingIds } from "@/tracking/resolve";
import TrackingShellClient from "./tracking-shell-client";

// Storefront tracking shell — server component (ADV-9).
// Resolves the configured public tracking ids from Admin Settings DB
// (`seo.*` keys) with server-env fallback, via src/tracking/resolve.ts,
// and hands ONLY those public ids to the client shell. Access tokens are
// never resolved here and never serialised to the browser; CAPI reads
// them server-side through the same resolver.
export default async function TrackingShell({ children }: { children: ReactNode }) {
  const ids = await resolvePublicTrackingIds();

  return (
    <TrackingShellClient
      primaryPixel={ids.metaPixelId}
      backupPixel={ids.metaBackupPixelId}
      clarityId={ids.clarityProjectId}
    >
      {children}
    </TrackingShellClient>
  );
}
