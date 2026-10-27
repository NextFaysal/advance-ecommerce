"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick } from "@/i18n/locale";
import { CALL_CENTER_STRINGS } from "../strings";

/**
 * Lightweight board refresh: re-runs the server component every 20s
 * while the tab is visible. This is deliberately POLLING — true
 * realtime push (websockets / SSE fan-out) waits for the worker host,
 * which does not exist yet; do not mistake this for live streaming.
 *
 * CD2: the component now also RENDERS the freshness indicator so the
 * polling is visible and honest — it shows when the board data was
 * generated (the server component's generatedAt, Asia/Dhaka) and a
 * countdown to the next scheduled poll. The refresh mechanism itself
 * (interval + router.refresh below) is unchanged.
 */
export function AutoRefresh({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  const [secondsLeft, setSecondsLeft] = useState(20);
  const [justUpdated, setJustUpdated] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20_000);
    return () => clearInterval(timer);
  }, [router]);

  // New board data arrived (generatedAt changed): restart the
  // countdown and flash the timestamp once so the update is visible.
  useEffect(() => {
    setSecondsLeft(20);
    setJustUpdated(true);
    const t = setTimeout(() => setJustUpdated(false), 1600);
    return () => clearTimeout(t);
  }, [generatedAt]);

  // Display-only countdown; pauses while the tab is hidden, matching
  // the poll's own visibility gate.
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") {
        setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
      }
    }, 1_000);
    return () => clearInterval(tick);
  }, []);

  const updatedAt = new Date(generatedAt).toLocaleTimeString(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    hour12: false,
  });

  return (
    <p role="status" className="inline-flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
      <Icon name="refresh-ccw" size={13} className="text-brand-600" />
      <span>
        {interpolate(s.lastUpdatedLine, { time: updatedAt, sec: secondsLeft }).split(updatedAt)[0]}
        <span
          className={`rounded px-1 font-mono tabular-nums transition-colors duration-700 ${
            justUpdated ? "bg-brand-100 text-brand-700" : ""
          }`}
        >
          {updatedAt}
        </span>
        {interpolate(s.lastUpdatedLine, { time: updatedAt, sec: secondsLeft }).split(updatedAt)[1]}
      </span>
    </p>
  );
}
