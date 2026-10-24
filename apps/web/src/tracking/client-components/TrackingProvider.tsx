"use client";

/**
 * TrackingProvider — Agent 26.
 *
 * MOUNT CONTRACT (for the main agent wiring the root layout):
 *   <TrackingProvider pixelId={...} pathname={...}>
 *     {children}
 *   </TrackingProvider>
 *
 * - pixelId: the Meta pixel id from the PUBLIC tracking settings, or
 *   null/omitted while unconfigured — the client then runs in no-op mode
 *   (no network sends; track() still returns shared eventIds). Never pass
 *   an access token here; tokens are server-only (../settings.ts).
 * - pathname: pass the current path on every route change (in Next.js App
 *   Router, a small client wrapper in the root layout passes
 *   usePathname()). This component deliberately does NOT import
 *   next/navigation. When pathname is omitted it falls back to the initial
 *   page load + popstate (browser back/forward) PageViews only, and SPA
 *   navigations will NOT be tracked — pass pathname for full coverage.
 * - Mount <ConsentBanner /> as a sibling (usually right after this
 *   provider) — the banner writes the consent choice that this provider's
 *   client reads on every track() call.
 * - Descendants read the client via useTracking(): the context value is
 *   { client, mode, track } — call track({ eventName: "AddToCart", ... })
 *   and pass result.eventId to the server flow for CAPI dedup.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createTrackingClient,
  type TrackingClient,
  type TrackingClientMode,
} from "../client/pixel-client";
import { captureUtmFromUrl } from "../client/utm-capture";

export interface TrackingContextValue {
  client: TrackingClient;
  mode: TrackingClientMode;
  track: TrackingClient["track"];
}

const TrackingContext = createContext<TrackingContextValue | null>(null);

export function useTracking(): TrackingContextValue {
  const ctx = useContext(TrackingContext);
  if (!ctx) {
    throw new Error("useTracking must be used inside <TrackingProvider>.");
  }
  return ctx;
}

export interface TrackingProviderProps {
  /** Meta pixel id (public), or null/omitted for no-op mode. */
  pixelId?: string | null;
  /** Current pathname from the host router — see the mount contract. */
  pathname?: string | null;
  /** Set false to disable UTM capture on mount (default: capture). */
  captureUtm?: boolean;
  children?: ReactNode;
}

export function TrackingProvider({
  pixelId,
  pathname,
  captureUtm = true,
  children,
}: TrackingProviderProps) {
  const [client] = useState<TrackingClient>(() => createTrackingClient({ pixelId }));

  const value = useMemo<TrackingContextValue>(
    () => ({ client, mode: client.mode, track: client.track }),
    [client],
  );

  // Capture first/last-touch UTM once, on mount (landing).
  useEffect(() => {
    if (captureUtm) captureUtmFromUrl();
  }, [captureUtm]);

  // PageView on route change. When the host passes `pathname`, every
  // change fires; otherwise fall back to popstate (back/forward) so the
  // component still works outside Next.js routing.
  const lastTrackedPath = useRef<string | null>(null);
  useEffect(() => {
    const firePageView = (path: string): void => {
      if (lastTrackedPath.current === path) return;
      lastTrackedPath.current = path;
      void client.track({
        eventName: "PageView",
        eventSourceUrl: typeof window !== "undefined" ? window.location.href : null,
      });
    };
    if (pathname != null) {
      firePageView(pathname);
      return;
    }
    firePageView(window.location.pathname);
    const onPopState = (): void => firePageView(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [client, pathname]);

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>;
}
