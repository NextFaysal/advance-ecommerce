"use client";
// Countdown display for product_offer blocks — client-only timer text.
// Purely presentational: expiry never blocks ordering here (checkout
// re-validates stock/price); it only shows remaining time in Bangla.
import { useEffect, useState } from "react";

function remainingLabel(endsAtIso: string, nowMs: number): string {
  const diff = Date.parse(endsAtIso) - nowMs;
  if (Number.isNaN(diff)) return "";
  if (diff <= 0) return "অফারের সময় শেষ হয়ে গেছে";
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `অফার শেষ হতে বাকি: ${days} দিন ${hours} ঘণ্টা`;
  if (hours > 0) return `অফার শেষ হতে বাকি: ${hours} ঘণ্টা ${minutes} মিনিট`;
  return `অফার শেষ হতে বাকি: ${minutes} মিনিট`;
}

export function CountdownNote({ endsAt }: { endsAt: string }) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const label = remainingLabel(endsAt, nowMs);
  if (!label) return null;
  return (
    <p role="timer" className="mt-2 inline-block rounded-full bg-rose-50 px-3 py-1 text-sm font-medium text-rose-600">
      ⏰ {label}
    </p>
  );
}
