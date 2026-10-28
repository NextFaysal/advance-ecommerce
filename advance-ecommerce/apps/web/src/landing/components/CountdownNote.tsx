"use client";
// Countdown display for product_offer blocks — client-only timer text.
// Purely presentational: expiry never blocks ordering here (checkout
// re-validates stock/price); it only shows the remaining time.
// Copy comes from the landing dictionary (doc 34 L1) — before L1 the
// label was hardcoded Bangla; the locale now arrives from LandingView.
import { useEffect, useState } from "react";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { LANDING_STRINGS } from "../strings";

function remainingLabel(endsAtIso: string, nowMs: number, locale: Locale): string {
  const s = pick(locale, LANDING_STRINGS);
  const diff = Date.parse(endsAtIso) - nowMs;
  if (Number.isNaN(diff)) return "";
  if (diff <= 0) return s.countdownExpired;
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return interpolate(s.countdownDays, { days, hours });
  if (hours > 0) return interpolate(s.countdownHours, { hours, minutes });
  return interpolate(s.countdownMinutes, { minutes });
}

export function CountdownNote({ endsAt, locale = "bn" }: { endsAt: string; locale?: Locale }) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const label = remainingLabel(endsAt, nowMs, locale);
  if (!label) return null;
  return (
    <p role="timer" className="mt-2 inline-block rounded-full bg-rose-50 px-3 py-1 text-sm font-medium text-rose-600">
      ⏰ {label}
    </p>
  );
}
