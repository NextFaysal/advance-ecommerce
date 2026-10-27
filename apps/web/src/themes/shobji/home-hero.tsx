"use client";

/**
 * Shobji home hero (doc 27 theme T-B) — client island.
 *
 * A pale LAVENDER panel: on the left, this package's own Bangla
 * headline and subline, with a LARGE search box beneath the
 * headline (a plain GET form to /search?q= — the same contract the
 * header search uses); on the right, the store's FIRST CMS hero
 * slide image when one exists, else a category tile for the first
 * live category, else a plain lavender panel — graceful at every
 * slide count, and nothing is ever faked: the image, when shown,
 * is the merchant's own CMS image and links to that slide's real
 * CTA href.
 *
 * While CMS slides exist, the panel's headline/subline/CTA come
 * from the ACTIVE slide (the store's own copy) and the panel
 * cycles through the slides like the other packages' heroes; the
 * search box and layout stay this package's. With no slides at
 * all, the panel shows this package's own static lines.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { Category } from "@/catalog/types";
import type { HeroSlide } from "@/cms/site-content-types";

function BigSearch() {
  return (
    <form action="/search" role="search" className="mt-5 max-w-xl">
      <div className="relative">
        <input
          type="search"
          name="q"
          placeholder="কী খুঁজছেন? যেমন: আলু, পেঁয়াজ, টমেটো…"
          aria-label="পণ্য খুঁজুন"
          className="w-full rounded-full border border-input bg-card py-3.5 pl-5 pr-14 text-[15px] text-text-main shadow-card transition placeholder:text-text-subtle focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        <button
          type="submit"
          aria-label="খুঁজুন"
          className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-white transition hover:opacity-90"
        >
          <Icon name="search" size={19} />
        </button>
      </div>
    </form>
  );
}

/** The right-hand visual slot: the active slide's image, else the
 *  first slide's image, else a category tile, else plain panel. */
function VisualSlot({
  slide,
  category,
}: {
  slide: HeroSlide | null;
  category: Category | null;
}) {
  if (slide?.imageUrl) {
    const img = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={slide.imageUrl}
        alt={slide.headlineBn}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    );
    return (
      <div className="relative min-h-[180px] overflow-hidden rounded-xl shadow-card lg:min-h-full">
        {slide.ctaHref ? (
          <Link href={slide.ctaHref} aria-label={slide.headlineBn} className="block h-full">
            {img}
          </Link>
        ) : (
          img
        )}
      </div>
    );
  }
  if (category) {
    return (
      <Link
        href={`/shop?category=${category.slug}`}
        className="group relative block min-h-[180px] overflow-hidden rounded-xl shadow-card lg:min-h-full"
        aria-label={category.name.bn}
      >
        {category.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={category.imageUrl}
            alt={category.name.bn}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <span aria-hidden="true" className="brand-gradient absolute inset-0" />
        )}
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 block p-4">
          <span className="block font-display text-lg font-extrabold leading-snug text-white">
            {category.name.bn}
          </span>
          <span className="mt-0.5 block text-xs text-white/85">
            {category.productCount}টি পণ্য — সব দেখুন →
          </span>
        </span>
      </Link>
    );
  }
  return (
    <div aria-hidden="true" className="brand-gradient relative hidden overflow-hidden rounded-xl opacity-90 lg:block">
      <span className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/15" />
      <span className="absolute -bottom-12 -left-6 h-48 w-48 rounded-full bg-white/10" />
    </div>
  );
}

export default function ShobjiHomeHero({
  slides,
  firstCategory,
}: {
  slides: HeroSlide[];
  firstCategory: Category | null;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback(
    (i: number) => {
      if (slides.length === 0) return;
      setIndex(((i % slides.length) + slides.length) % slides.length);
    },
    [slides.length],
  );

  useEffect(() => {
    if (paused || slides.length < 2) return;
    timer.current = setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, 6000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [paused, slides.length]);

  const active = slides[index] ?? null;

  return (
    <section
      aria-label="হাইলাইট"
      className="mt-4"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="grid gap-4 rounded-2xl bg-secondary p-5 shadow-card sm:p-7 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:p-9">
        {/* Left — headline (CMS copy when slides exist, else our
            own static lines) + the big search box beneath. */}
        <div className="flex min-w-0 flex-col justify-center">
          {active ? (
            <>
              <h1 className="max-w-xl font-display text-2xl font-extrabold leading-snug text-text-main sm:text-[34px] sm:leading-tight">
                {active.headlineBn}
              </h1>
              {active.subtextBn ? (
                <p className="mt-2 max-w-lg text-sm leading-6 text-text-muted sm:text-[15px]">
                  {active.subtextBn}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h1 className="max-w-xl font-display text-2xl font-extrabold leading-snug text-text-main sm:text-[34px] sm:leading-tight">
                আজকের টাটকা বাজার, সরাসরি আপনার দরজায়
              </h1>
              <p className="mt-2 max-w-lg text-sm leading-6 text-text-muted sm:text-[15px]">
                সবজি, ফল, মাছ-মাংস আর নিত্যপ্রয়োজনীয় সবকিছু — যত্নে বাছাই করে
                দ্রুত পৌঁছে দিই আপনার বাসায়।
              </p>
            </>
          )}
          <BigSearch />
          {active?.ctaLabelBn && active.ctaHref ? (
            <Link
              href={active.ctaHref}
              className="mt-4 inline-flex h-11 w-fit items-center rounded-full bg-primary px-5 text-sm font-bold text-white shadow-md transition hover:opacity-90"
            >
              {active.ctaLabelBn}
            </Link>
          ) : null}
          {slides.length > 1 ? (
            <div className="mt-5 flex items-center gap-1.5" role="tablist" aria-label="ব্যানার বেছে নিন">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={`ব্যানার ${i + 1}`}
                  onClick={() => goTo(i)}
                  className="flex h-8 w-6 items-center justify-center"
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 rounded-full transition-all duration-300 ${
                      i === index ? "w-6 bg-primary" : "w-2 bg-primary/30"
                    }`}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Right — slide image / category tile / panel */}
        <VisualSlot slide={active} category={firstCategory} />
      </div>
    </section>
  );
}
