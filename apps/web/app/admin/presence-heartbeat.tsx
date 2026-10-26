"use client";

/**
 * Staff presence heartbeat — layout-wide mount (ADV-27 remainder,
 * doc 23 wave 53-4 follow-up).
 *
 * Wave 53 mounted the heartbeat ONLY on the order detail page, so
 * presence entries existed only for staff looking at an order. This
 * component is mounted once in the admin layout shell and heartbeats
 * the CURRENT /admin path (via usePathname, so soft navigations
 * re-heartbeat the new path immediately), which makes presence cover
 * every admin page. Auth screens never mount it — the layout returns
 * before the shell for /admin/login and /admin/accept-invite.
 *
 * It renders NOTHING and shows no banner: page-level surfaces that
 * want to display presence (the order detail edit-conflict warning)
 * poll GET /api/v1/admin/presence themselves.
 *
 * Failure mode matches the wave-53 contract: presence is best-effort
 * (Redis-backed with a silent fallback) — a failed heartbeat is
 * swallowed, never surfaced.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export const PRESENCE_HEARTBEAT_MS = 30_000;

/** POST one heartbeat for `path`. Never throws, never surfaces. */
export async function postPresenceHeartbeat(path: string): Promise<void> {
  try {
    await fetch("/api/v1/admin/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
      cache: "no-store",
    });
  } catch {
    // Presence is best-effort — never surface an error for it.
  }
}

/**
 * Heartbeat `path` on mount / path change and every 30s after that
 * (server TTL is 75s, so a closed tab fades out on its own).
 */
export function usePresenceHeartbeat(path: string | null): void {
  useEffect(() => {
    if (path === null || !path.startsWith("/admin")) return;
    // The presence API caps path at 200 chars; longer paths simply
    // are not tracked (their heartbeat would 400 and be ignored
    // anyway) — skip the call instead of sending a doomed one.
    if (path.length > 200) return;
    void postPresenceHeartbeat(path);
    const timer = setInterval(() => void postPresenceHeartbeat(path), PRESENCE_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [path]);
}

/** Layout mount: heartbeat-only, renders nothing. */
export function PresenceHeartbeatGlobal() {
  const pathname = usePathname();
  usePresenceHeartbeat(pathname);
  return null;
}
