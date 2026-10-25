"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Lightweight board refresh: re-runs the server component every 20s
 * while the tab is visible. This is deliberately POLLING — true
 * realtime push (websockets / SSE fan-out) waits for the worker host,
 * which does not exist yet; do not mistake this for live streaming.
 */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
