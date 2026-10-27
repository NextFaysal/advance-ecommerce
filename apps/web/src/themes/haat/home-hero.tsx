"use client";

/**
 * Haat home hero (doc 27 theme T-A) — client island.
 *
 * Full-width hero carousel with a narrow side panel tile, in the
 * marketplace layout's proportions. Both slots are driven by the
 * store's OWN CMS hero slides (Admin → Content): the carousel
 * cycles every slide, the narrow slot shows the second slide.
 * With fewer than two slides the narrow slot degrades to a
 * category promo tile (the first live category); with no slides
 * at all the main slot is our own static promo panel and the
 * narrow slot is the category tile — nothing is ever faked:
 * every image, headline and link comes from CMS data or the live
 * category list passed in as props.
 *
 * The side panel is gated by the package's `heroSidePanel`
 * merchant option (read from the ThemeView context): off → the
 * carousel spans the full width. Auto-advance pauses on
 * hover/focus; dot indicators double as the slide picker. All
 * copy is the merchant's CMS copy (or our static fallback
 * lines) — no third-party campaign text or artwork.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Category } from "@/catalog/types";
import type { HeroSlide } from "@/cms/site-content-types";
import { useThemeView } from "../theme-view";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { HAAT_STRINGS } from "./strings";

function SlidePanel({
  slide,
  priority = false,
}: {
  slide: HeroSlide;
  priority?: boolean;
}) {
  const inner = (
    <>
      {slide.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slide.imageUrl}
          alt={slide.headlineBn}
          loading={priority ? undefined : "lazy"}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true" className="brand-soft-gradient absolute inset-0" />
      )}
      <span
        aria-hidden="true"
        className={`absolute inset-0 ${slide.imageUrl ? "bg-gradient-to-t from-black/65 via-black/15 to-transparent" : ""}`}
      />
      <span className="absolute inset-x-0 bottom-0 block p-5 sm:p-7">
        <span
          className={`block max-w-lg font-display text-xl font-extrabold leading-snug sm:text-3xl ${
            slide.imageUrl ? "text-white" : "text-text-main"
          }`}
        >
          {slide.headlineBn}
        </span>
        {slide.subtextBn ? (
          <span
            className={`mt-1.5 block max-w-md text-sm leading-6 ${
              slide.imageUrl ? "text-white/85" : "text-text-muted"
            }`}
          >
            {slide.subtextBn}
          </span>
        ) : null}
        {slide.ctaLabelBn ? (
          <span className="mt-4 inline-flex h-11 items-center rounded bg-primary px-5 text-sm font-bold text-white shadow-md transition hover:opacity-90">
            {slide.ctaLabelBn}
          </span>
        ) : null}
      </span>
    </>
  );
  const cls =
    "relative block h-full min-h-[240px] w-full overflow-hidden rounded shadow-card sm:min-h-[320px]";
  return slide.ctaHref ? (
    <Link href={slide.ctaHref} className={cls} aria-label={slide.headlineBn}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Static fallback panel — our own copy, shown only while the store
 *  has no active CMS hero slides. */
function StaticPanel() {
  const { locale } = useLocale();
  const s = pick(locale, HAAT_STRINGS);
  return (
    <div className="brand-soft-gradient relative block h-full min-h-[240px] w-full overflow-hidden rounded shadow-card sm:min-h-[320px]">
      <span aria-hidden="true" className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-primary/10" />
      <span aria-hidden="true" className="absolute -bottom-14 -left-8 h-52 w-52 rounded-full bg-primary/5" />
      <span className="absolute inset-x-0 bottom-0 block p-5 sm:p-7">
        <span className="block max-w-lg font-display text-xl font-extrabold leading-snug text-text-main sm:text-3xl">
          {s.heroHeadline}
        </span>
        <span className="mt-1.5 block max-w-md text-sm leading-6 text-text-muted">
          {s.heroSubtext}
        </span>
        <Link
          href="/shop"
          className="mt-4 inline-flex h-11 items-center rounded bg-primary px-5 text-sm font-bold text-white shadow-md transition hover:opacity-90"
        >
          {s.heroViewAllProducts}
        </Link>
      </span>
    </div>
  );
}

/** The narrow right-hand slot: second slide, else a category tile. */
function SideSlot({
  slide,
  category,
}: {
  slide: HeroSlide | null;
  category: Category | null;
}) {
  const { locale } = useLocale();
  const s = pick(locale, HAAT_STRINGS);
  if (slide) {
    return (
      <div className="relative min-h-[160px] overflow-hidden rounded shadow-card lg:min-h-full">
        <SlidePanel slide={slide} />
      </div>
    );
  }
  if (category) {
    return (
      <Link
        href={`/shop?category=${category.slug}`}
        className="group relative block min-h-[160px] overflow-hidden rounded shadow-card lg:min-h-full"
        aria-label={category.name[locale] || category.name.bn}
      >
        {category.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={category.imageUrl}
            alt={category.name[locale] || category.name.bn}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <span aria-hidden="true" className="brand-soft-gradient absolute inset-0" />
        )}
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 block p-4">
          <span className="block font-display text-lg font-extrabold leading-snug text-white">
            {category.name[locale] || category.name.bn}
          </span>
          <span className="mt-0.5 block text-xs text-white/85">
            {interpolate(s.heroCategoryCountViewAll, { count: category.productCount })}
          </span>
        </span>
      </Link>
    );
  }
  return (
    <Link
      href="/shop"
      className="brand-soft-gradient group relative block min-h-[160px] overflow-hidden rounded shadow-card lg:min-h-full"
    >
      <span className="absolute inset-x-0 bottom-0 block p-4">
        <span className="block font-display text-lg font-extrabold leading-snug text-text-main">
          {s.heroAllCategories}
        </span>
        <span className="mt-0.5 block text-xs text-text-muted">{s.heroAllCategoriesHint}</span>
      </span>
    </Link>
  );
}

export default function HaatHomeHero({
  slides,
  firstCategory,
}: {
  slides: HeroSlide[];
  firstCategory: Category | null;
}) {
  const { locale } = useLocale();
  const str = pick(locale, HAAT_STRINGS);
  const themeView = useThemeView();
  const showSidePanel = themeView.options.heroSidePanel !== false;

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

  const sideSlide = slides.length >= 2 ? slides[1]! : null;

  return (
    <section
      aria-label={str.heroHighlightAria}
      className={`mt-4 grid gap-3 ${showSidePanel ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]" : ""}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="relative min-w-0">
        {slides.length > 0 ? (
          <SlidePanel slide={slides[index]!} priority={index === 0} />
        ) : (
          <StaticPanel />
        )}
        {slides.length > 1 ? (
          <div className="absolute bottom-4 right-5 flex items-center gap-1.5" role="tablist" aria-label={str.bannerPickerAria}>
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={interpolate(str.bannerN, { n: i + 1 })}
                onClick={() => goTo(i)}
                className="flex h-8 w-6 items-center justify-center"
              >
                <span
                  aria-hidden="true"
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === index ? "w-6 bg-primary" : "w-2 bg-white/70 shadow-sm"
                  }`}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {showSidePanel ? <SideSlot slide={sideSlide} category={firstCategory} /> : null}
    </section>
  );
}
