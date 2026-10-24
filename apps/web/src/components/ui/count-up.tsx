"use client";

import { useEffect, useRef, useState } from "react";

/**
 * CountUp (Design System v3, plan §2) — animated number for KPI cards and
 * storefront stats. Counts 0 → `value` with an ease-out rAF curve the
 * first time it scrolls into view.
 *
 * Correctness rules: the component renders the FINAL value on the server
 * and until the animation actually starts, so no wrong number is ever
 * shown (SSR, no-JS, SEO). With prefers-reduced-motion or no
 * IntersectionObserver it simply keeps showing the final value. If
 * `value` changes while idle/finished, the display follows it; mid-run
 * it lands on the latest value.
 *
 * `format` renders every frame — the default groups digits en-IN style
 * (1,25,000). Pass a formatter for money / Bengali digits, e.g.
 *   <CountUp value={totalPoisha} format={(n) => formatMoney(n)} />
 */
const defaultFormat = (n: number): string => Math.round(n).toLocaleString("en-IN");

export function CountUp({
  value,
  format = defaultFormat,
  durationMs = 900,
  className = "",
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const valueRef = useRef(value);
  const phaseRef = useRef<"idle" | "running" | "done">("idle");
  const rafRef = useRef<number>(0);
  const [display, setDisplay] = useState<number>(value);

  // Keep the displayed number truthful when `value` changes outside a run.
  useEffect(() => {
    valueRef.current = value;
    if (phaseRef.current !== "running") setDisplay(value);
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || typeof IntersectionObserver === "undefined" || durationMs <= 0) {
      phaseRef.current = "done";
      setDisplay(valueRef.current);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || phaseRef.current !== "idle") return;
        phaseRef.current = "running";
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          const eased = 1 - Math.pow(1 - t, 3);
          setDisplay(valueRef.current * eased);
          if (t < 1) {
            rafRef.current = requestAnimationFrame(tick);
          } else {
            phaseRef.current = "done";
            setDisplay(valueRef.current);
          }
        };
        setDisplay(0);
        rafRef.current = requestAnimationFrame(tick);
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
    // Mount-only: durationMs is read once; `value` flows via valueRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span ref={ref} className={className}>
      {format(display)}
    </span>
  );
}
