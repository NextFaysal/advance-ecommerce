"use client";
/**
 * Standalone countdown block (doc 34 L2) — digit boxes (days /
 * hours / minutes / seconds) ticking every second toward a REAL
 * configured end: either the owner's explicit datetime or the live
 * flash sale's end, both resolved into `endsAt` by the view model.
 * §0.7 honesty: an expired countdown never resets or invents a new
 * deadline — it hides, or shows the owner's expired text, exactly
 * as configured. All copy arrives pre-picked for the visitor's
 * locale from LandingView; unit labels come from the landing
 * dictionary.
 */
import { useEffect, useState } from "react";
import { pick, type Locale } from "@/i18n/locale";
import { LANDING_STRINGS } from "../../strings";

export function CountdownBlock({
  endsAt,
  heading,
  expiredText,
  expiredBehavior,
  locale,
}: {
  endsAt: string;
  heading: string;
  expiredText: string;
  expiredBehavior: "hide" | "show_text";
  locale: Locale;
}) {
  const s = pick(locale, LANDING_STRINGS);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const target = Date.parse(endsAt);
  if (Number.isNaN(target)) return null;
  const diff = target - nowMs;

  if (diff <= 0) {
    if (expiredBehavior === "hide") return null;
    return (
      <section className="px-5 py-6 text-center">
        <p className="inline-block rounded-full bg-surface-2 px-4 py-2 font-medium leading-7">
          ⏰ {expiredText}
        </p>
      </section>
    );
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const units = [
    ...(days > 0 ? [{ value: days, label: s.countdownUnitDays }] : []),
    { value: hours, label: s.countdownUnitHours },
    { value: minutes, label: s.countdownUnitMinutes },
    { value: seconds, label: s.countdownUnitSeconds },
  ];

  return (
    <section className="px-5 py-6 text-center">
      {heading ? <h2 className="text-xl font-bold">{heading}</h2> : null}
      <div role="timer" className="mt-3 flex flex-wrap justify-center gap-2">
        {units.map((u) => (
          <div
            key={u.label}
            className="flex min-w-[64px] flex-col items-center rounded-xl bg-brand-600 px-3 py-2 text-white shadow-sm"
          >
            <span className="text-2xl font-bold tabular-nums">{String(u.value).padStart(2, "0")}</span>
            <span className="text-xs">{u.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
