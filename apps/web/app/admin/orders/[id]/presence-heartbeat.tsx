"use client";

/**
 * Presence edit-conflict WARNING — admin order detail rail
 * (ADV-27 remainder, doc 23 wave 53-4).
 *
 * What it does:
 * - Polls GET /api/v1/admin/presence?path=/admin/orders/<id> every
 *   15s. The API returns `onPath` = OTHER staff currently on this
 *   order (the caller is excluded server-side).
 * - If anyone else is here, renders an amber WARNING banner naming
 *   them ("X এই অর্ডারটি দেখছেন"). It is a warning ONLY — it never
 *   locks, blocks, or disables any editing control.
 *
 * The heartbeat itself is NOT sent from here anymore: the admin
 * layout mounts PresenceHeartbeatGlobal (app/admin/presence-heartbeat),
 * which heartbeats the current /admin path on every admin page —
 * including this one — so this component only polls and displays.
 * (Wave 53 sent the heartbeat from this component because the layout
 * mount did not exist yet; behaviour for the order page is
 * unchanged: same path heartbeated, same 30s cadence, same TTL.)
 *
 * Failure mode: presence is Redis-backed with a silent fallback —
 * if every call fails, the banner just never appears. No error is
 * ever surfaced for presence.
 */
import { useCallback, useEffect, useState } from "react";
import { pick } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";

const POLL_MS = 15_000;

interface PresenceEntry {
  userId: string;
  name: string;
  path: string;
  at: string;
}

export function PresenceHeartbeat({ orderId }: { orderId: string }) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const path = `/admin/orders/${orderId}`;
  const [others, setOthers] = useState<PresenceEntry[]>([]);

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
    void poll();
    const pollTimer = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearInterval(pollTimer);
    };
  }, [poll]);

  if (others.length === 0) return null;

  const names = others.map((o) => o.name || s.presenceStaff).join(", ");
  return (
    <div
      role="status"
      className="rounded-md border border-warning-solid/30 bg-warning-soft px-4 py-3 text-small text-warning-solid"
    >
      <p className="font-semibold">{names} {s.presenceViewing}</p>
      <p className="mt-1 leading-relaxed">
        {s.presenceWarning}
      </p>
    </div>
  );
}
