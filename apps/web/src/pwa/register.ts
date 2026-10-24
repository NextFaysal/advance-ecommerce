/**
 * Service worker registration helper — Agent 12 (Step 30 base).
 * Client-side only. Contains no secrets and makes no API calls.
 * Wire this once from a client component in the root layout, e.g.
 *   useEffect(() => { void registerServiceWorker(); }, []);
 * (The layout itself belongs to another slice and is not edited here.)
 */
import { SERVICE_WORKER_PATH } from "./config";

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  if (process.env.NODE_ENV !== "production") {
    // Avoid stale-cache confusion in local dev; the SW file itself is
    // still served and can be tested from DevTools > Application.
    return null;
  }
  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/" });
  } catch {
    // Registration failure must never break the storefront/admin.
    return null;
  }
}

/** True when the app is running as an installed PWA (standalone display). */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
