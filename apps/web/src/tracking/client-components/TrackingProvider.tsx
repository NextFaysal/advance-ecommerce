"use client";

/**
 * TrackingProvider — Agent 26 + Multi-Pixel & Microsoft Clarity Live Engine.
 *
 * MOUNT CONTRACT:
 *   <TrackingProvider
 *     pixelId={...}
 *     pixelIds={[...]}
 *     clarityProjectId={...}
 *     pathname={...}
 *   >
 *     {children}
 *   </TrackingProvider>
 *
 * - pixelId / pixelIds: Meta pixel ID(s) (public). Supports a single ID,
 *   comma-separated IDs, or array of IDs. Initializes all configured pixels via fbq('init', id).
 * - clarityProjectId: Microsoft Clarity project ID (e.g. "k9x3...").
 *   Automatically initializes Microsoft Clarity session recording & heatmaps on client.
 * - pathname: Current path on route change for SPA navigation PageViews.
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

/**
 * Run `callback` when the browser is idle (requestIdleCallback, capped by
 * the given timeout) or after the timeout on browsers without it. Returns
 * a cancel function for effect cleanup. Third-party pixels are deferred
 * this way so they never compete with first paint / hydration — server-
 * side CAPI already covers the events, so the delay loses nothing.
 */
type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

function deferUntilIdle(callback: () => void, timeoutMs = 3500): () => void {
  if (typeof window === "undefined") return () => undefined;
  const win = window as IdleWindow;
  if (typeof win.requestIdleCallback === "function") {
    const id = win.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => win.cancelIdleCallback?.(id);
  }
  const timer = window.setTimeout(callback, timeoutMs);
  return () => window.clearTimeout(timer);
}

export interface TrackingProviderProps {
  /** Primary Meta pixel id (or comma-separated ids), or null/omitted for no-op mode. */
  pixelId?: string | string[] | null;
  /** Multiple Meta pixel ids (primary + backup/agency pixels). */
  pixelIds?: string[] | null;
  /** Microsoft Clarity Project ID (alphanumeric), or null/omitted to disable. */
  clarityProjectId?: string | null;
  /** Current pathname from the host router. */
  pathname?: string | null;
  /** Set false to disable UTM capture on mount (default: capture). */
  captureUtm?: boolean;
  children?: ReactNode;
}

export function TrackingProvider({
  pixelId,
  pixelIds,
  clarityProjectId,
  pathname,
  captureUtm = true,
  children,
}: TrackingProviderProps) {
  const parsedPixelIds = useMemo(() => {
    const list: string[] = [];
    if (typeof pixelId === "string") {
      list.push(...pixelId.split(","));
    } else if (Array.isArray(pixelId)) {
      list.push(...pixelId);
    }
    if (Array.isArray(pixelIds)) {
      list.push(...pixelIds);
    }
    return Array.from(new Set(list.map((id) => id.trim()).filter((id) => id.length > 0)));
  }, [pixelId, pixelIds]);

  const [client] = useState<TrackingClient>(() =>
    createTrackingClient({ pixelIds: parsedPixelIds }),
  );

  const value = useMemo<TrackingContextValue>(
    () => ({ client, mode: client.mode, track: client.track }),
    [client],
  );

  // Capture first/last-touch UTM once, on mount (landing).
  useEffect(() => {
    if (captureUtm) captureUtmFromUrl();
  }, [captureUtm]);

  // 1. Meta (Facebook) Pixel Base Script & Multi-Pixel Initialization
  // Deferred until the browser is idle (see deferUntilIdle above).
  useEffect(() => {
    if (parsedPixelIds.length === 0 || typeof window === "undefined") return;

    return deferUntilIdle(() => {
      try {
        const win = window as any;
        if (!win.fbq) {
          const n: any = (win.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
          });
          if (!win._fbq) win._fbq = n;
          n.push = n;
          n.loaded = true;
          n.version = "2.0";
          n.queue = [];
          const t = document.createElement("script");
          t.async = true;
          t.id = "meta-pixel-script";
          t.src = "https://connect.facebook.net/en_US/fbevents.js";
          const s = document.getElementsByTagName("script")[0];
          s?.parentNode?.insertBefore(t, s);
        }

        // Initialize all configured pixels (Primary + Backup / Agency pixels)
        parsedPixelIds.forEach((pid) => {
          win.fbq("init", pid);
        });
      } catch {
        // Ignore injection error in non-standard / sandboxed environments
      }
    });
  }, [parsedPixelIds]);

  // 2. Microsoft Clarity Script Injection (Heatmaps & Session Recordings)
  // Deferred until the browser is idle (see deferUntilIdle above).
  useEffect(() => {
    const cid = (clarityProjectId ?? "").trim();
    if (!cid || typeof window === "undefined") return;

    return deferUntilIdle(() => {
      // Guard: do not double-inject Clarity
      const existing = document.getElementById("microsoft-clarity-tag");
      if (existing) return;

      try {
        (function (c: any, l: any, a: any, r: any, i: any, t?: any, y?: any) {
          c[a] =
            c[a] ||
            function () {
              (c[a].q = c[a].q || []).push(arguments);
            };
          t = l.createElement(r);
          t.async = 1;
          t.id = "microsoft-clarity-tag";
          t.src = "https://www.clarity.ms/tag/" + i;
          y = l.getElementsByTagName(r)[0];
          y.parentNode?.insertBefore(t, y);
        })(window, document, "clarity", "script", cid);
      } catch {
        // Ignore injection error in non-standard environments
      }
    });
  }, [clarityProjectId]);

  // PageView on route change
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
