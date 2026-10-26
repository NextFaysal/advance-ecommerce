"use client";

/**
 * Presence heartbeat + edit-conflict WARNING — admin order detail
 * rail (ADV-27 remainder, doc 23 wave 53-4).
 *
 * What it does:
 * - Heartbeats POST /api/v1/admin/presence { path: /admin/orders/<id> }
 *   on mount and every 30s (server TTL is 75s, so a closed tab fades
 *   out on its own).
 * - Polls GET /api/v1/admin/presence?path=<same> every 15s. The API
 *   returns `onPath` = OTHER staff currently on this order (the
 *   caller is excluded server-side).
 * - If anyone else is here, renders an amber WARNING banner naming
 *   them ("X এই অর্ডারটি দেখছেন"). It is a warning ONLY — it never
 *   locks, blocks, or disables any editing control.
 *
 * Scope note: this wave mounts the heartbeat ONLY on the order
 * detail page. A layout-wide heartbeat (which would make presence
 * cover every admin page) is a parent decision — the API + service
 * already support any /admin path.
 *
 * Failure mode: presence is Redis-backed with a silent fallback —
 * if every call fails, the banner just never appears. No error is
 * ever surfaced for presence.
 */
import { useCallback, useEffect, useState } from "react";

const HEARTBEAT_MS = 30_000;
const POLL_MS = 15_000;

interface PresenceEntry {
  userId: string;
  name: string;
  path: string;
  at: string;
}

export function PresenceHeartbeat({ orderId }: { orderId: string }) {
  const path = `/admin/orders/${orderId}`;
  const [others, setOthers] = useState<PresenceEntry[]>([]);

  const heartbeat = useCallback(async () => {
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
  }, [path]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/presence?path=${encodeURIComponent(path)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: { onPath?: PresenceEntry[] } };
      setOthers(json.data?.onPath ?? []);
    } catch {
      // Same as above: silent.
    }
  }, [path]);

  useEffect(() => {
    void heartbeat();
    void poll();
    const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_MS);
    const pollTimer = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(pollTimer);
    };
  }, [heartbeat, poll]);

  if (others.length === 0) return null;

  const names = others.map((o) => o.name || "একজন স্টাফ").join(", ");
  return (
    <div
      role="status"
      className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-small text-amber-900"
    >
      <p className="font-semibold">{names} এই অর্ডারটি দেখছেন</p>
      <p className="mt-1 leading-relaxed">
        সতর্কতা: একই সময়ে দুজন সম্পাদনা করলে একজনের পরিবর্তন অন্যজনেরটা মুছে ফেলতে পারে — কাজ
        ভাগ করে নিন। এটি শুধু সতর্কবার্তা; কোনো লক বা বাধা নয়।
      </p>
    </div>
  );
}
