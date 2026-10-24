"use client";

// Homepage hero campaign slides — client slider.
// Mounted by app/page.tsx ONLY when at least one active slide is
// configured in Admin → Content (CMS hero slides, persisted in the
// Setting table — src/cms/site-content.ts). With zero slides the page
// renders its static hero exactly as before; this component is never
// in the tree.
//
// Props are serializable slide data plus two ReactNode slots the
// SERVER component fills (the aurora visual composition and the
// catalogue stats row) — no function props cross the boundary.
// Behaviour: auto-advance every 6s, pause on hover/focus, prev/next
// arrows + dots (44px targets), prefers-reduced-motion disables
// auto-advance (the .anim-rise transition is also CSS-disabled under
// reduced motion in globals.css). SSR renders slide 0; rotation is
// client-side only, so hydration matches.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import type { HeroSlide } from "./site-content-types";

const AUTOPLAY_MS = 6000;

export interface HeroSlidesProps {
  slides: HeroSlide[];
  /** Right-column fallback when a slide has no image (server-rendered
   *  aurora card composition from app/page.tsx). */
  visual?: ReactNode;
  /** Optional stats row rendered under the slide copy (server node). */
  stats?: ReactNode;
}

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {dir === "left" ? <path d="M14.5 5.5 8 12l6.5 6.5" /> : <path d="M9.5 5.5 16 12l-6.5 6.5" />}
    </svg>
  );
}

export function HeroSlides({ slides, visual, stats }: HeroSlidesProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const count = slides.length;
  const go = useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count],
  );

  useEffect(() => {
    if (count < 2 || paused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    timer.current = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, AUTOPLAY_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [count, paused]);

  if (count === 0) return null;
  const slide = slides[Math.min(index, count - 1)] as HeroSlide;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="ক্যাম্পেইন স্লাইড"
      className="brand-soft-gradient mt-5 overflow-hidden rounded-3xl shadow-sm"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:p-12">
        <div className="min-w-0">
          <div key={slide.id} className="anim-rise" aria-roledescription="slide" aria-label={`${index + 1} / ${count}`}>
            <h1 className="break-words text-4xl font-extrabold leading-[1.2] text-text-main [overflow-wrap:anywhere] sm:text-5xl sm:leading-[1.15]">
              {slide.headlineBn}
            </h1>
            {slide.subtextBn ? (
              <p className="mt-4 max-w-lg break-words text-[15px] leading-7 text-text-muted [overflow-wrap:anywhere]">
                {slide.subtextBn}
              </p>
            ) : null}
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href={slide.ctaHref}
                className="brand-gradient rounded-xl px-6 py-3.5 text-[15px] font-bold text-white shadow-md transition hover:opacity-90"
              >
                {slide.ctaLabelBn}
              </Link>
              <Link
                href="/shop"
                className="rounded-xl border border-border bg-surface px-6 py-3.5 text-[15px] font-bold text-text-main shadow-sm transition hover:bg-surface-2"
              >
                সব পণ্য দেখুন
              </Link>
            </div>
          </div>

          {count > 1 ? (
            <div className="mt-8 flex items-center gap-3">
              <button
                type="button"
                onClick={() => go(index - 1)}
                aria-label="আগের স্লাইড"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-text-main shadow-sm transition hover:bg-surface-2"
              >
                <ChevronIcon dir="left" />
              </button>
              <div className="flex items-center gap-2" role="tablist" aria-label="স্লাইড বেছে নিন">
                {slides.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    aria-label={`স্লাইড ${i + 1}: ${s.headlineBn}`}
                    onClick={() => go(i)}
                    className="flex h-11 items-center px-1"
                  >
                    <span
                      className={`block h-2 rounded-full transition-all ${
                        i === index ? "w-7 bg-brand-600" : "w-2 bg-brand-200 hover:bg-brand-300"
                      }`}
                    />
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => go(index + 1)}
                aria-label="পরের স্লাইড"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-text-main shadow-sm transition hover:bg-surface-2"
              >
                <ChevronIcon dir="right" />
              </button>
            </div>
          ) : null}

          {stats}
        </div>

        {/* Right column: the slide's own image when it has one,
            otherwise the server-rendered aurora composition. */}
        <div className="relative hidden min-h-[320px] lg:block">
          {slide.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={slide.id}
              src={slide.imageUrl}
              alt={slide.headlineBn}
              className="anim-fade-in absolute inset-0 h-full w-full rounded-3xl object-cover shadow-md"
            />
          ) : (
            visual
          )}
        </div>
        {/* On mobile an image still shows (stacked under the copy);
            the aurora composition stays desktop-only, as today. */}
        {slide.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slide.imageUrl}
            alt={slide.headlineBn}
            className="h-52 w-full rounded-3xl object-cover shadow-md lg:hidden"
          />
        ) : null}
      </div>
    </section>
  );
}
