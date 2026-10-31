"use client";

/**
 * Circuit home hero (doc 27 T-D) — client island.
 *
 * Asymmetric hero: a big rounded banner carousel on the left and
 * TWO stacked promo tiles on the right. Every slot is driven by
 * the store's OWN data — the CMS hero slides (Admin → Content) and
 * the live category list passed in as props:
 * - the carousel cycles all CMS slides;
 * - the stacked tiles show the 2nd and 3rd slides when they exist,
 *   else real category tiles, else an all-categories tile;
 * - with no slides at all the main slot is our own static promo
 *   panel (our copy, our gradient) and the tiles are categories.
 * Nothing is faked: every image, headline and link comes from CMS
 * data or the live category list.
 *
 * Auto-advance pauses on hover/focus; dot indicators double as the
 * slide picker.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { CIRCUIT_STRINGS } from "./strings";
import Link from "next/link";
import type { Category } from "@/catalog/types";
import type { HeroSlide } from "@/cms/site-content-types";
import { StoreImage } from "@/storefront-ux/components/StoreImage";

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
        <StoreImage src={slide.imageUrl} alt={slide.headlineBn} preset="hero" fillParent priority={priority} />
      ) : (
        <span aria-hidden="true" className="brand-soft-gradient absolute inset-0" />
      )}
      <span
        aria-hidden="true"
        className={`absolute inset-0 ${slide.imageUrl ? "bg-gradient-to-t from-black/65 via-black/15 to-transparent" : ""}`}
      />
      <span className="absolute inset-x-0 bottom-0 block p-5 sm:p-7">
        <span
          className={`block max-w-lg font-display text-2xl font-extrabold leading-snug sm:text-3xl ${
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
          <span className="mt-4 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-bold text-white shadow-md transition hover:opacity-90">
            {slide.ctaLabelBn}
          </span>
        ) : null}
      </span>
    </>
  );
  const cls =
    "relative block h-full min-h-[260px] w-full overflow-hidden rounded-2xl shadow-card sm:min-h-[340px]";
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
function CategoryCount({ category }: { category: Category }) {
  const { locale } = useLocale();
  const s = pick(locale, CIRCUIT_STRINGS);
  return <>{interpolate(s.sideCategoryCount, { count: category.productCount })}</>;
}

function StaticPanel() {
  const { locale } = useLocale();
  const str = pick(locale, CIRCUIT_STRINGS);
  return (
    <div className="brand-soft-gradient relative block h-full min-h-[260px] w-full overflow-hidden rounded-2xl shadow-card sm:min-h-[340px]">
      <span aria-hidden="true" className="bg-accent absolute -right-12 -top-12 h-48 w-48 rounded-full opacity-20" />
      <span aria-hidden="true" className="absolute -bottom-16 -left-10 h-56 w-56 rounded-full bg-primary/10" />
      <span className="absolute inset-x-0 bottom-0 block p-5 sm:p-7">
        <span className="block max-w-lg font-display text-2xl font-extrabold leading-snug text-text-main sm:text-3xl">
          {str.staticHeadline}
        </span>
        <span className="mt-1.5 block max-w-md text-sm leading-6 text-text-muted">
          {str.staticSubtext}
        </span>
        <Link
          href="/shop"
          className="mt-4 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-bold text-white shadow-md transition hover:opacity-90"
        >
          {str.staticCta}
        </Link>
      </span>
    </div>
  );
}

/** One of the two stacked right-hand tiles: a CMS slide panel. */
function SlideTile({ slide }: { slide: HeroSlide }) {
  return (
    <div className="relative min-h-[120px] flex-1 overflow-hidden rounded-2xl shadow-card">
      <Link
        href={slide.ctaHref || "/shop"}
        className="absolute inset-0"
        aria-label={slide.headlineBn}
      >
        {slide.imageUrl ? (
          <StoreImage src={slide.imageUrl} alt={slide.headlineBn} preset="hero" fillParent />
        ) : (
          <span aria-hidden="true" className="brand-soft-gradient absolute inset-0" />
        )}
        <span
          aria-hidden="true"
          className={`absolute inset-0 ${slide.imageUrl ? "bg-gradient-to-t from-black/60 via-black/10 to-transparent" : ""}`}
        />
        <span className="absolute inset-x-0 bottom-0 block p-4">
          <span
            className={`block font-display text-base font-extrabold leading-snug ${
              slide.imageUrl ? "text-white" : "text-text-main"
            }`}
          >
            {slide.headlineBn}
          </span>
        </span>
      </Link>
    </div>
  );
}

/** A stacked tile from a real category. */
function CategoryTile({ category }: { category: Category }) {
  const { locale } = useLocale();
  return (
    <Link
      href={`/shop?category=${category.slug}`}
      className="group relative block min-h-[120px] flex-1 overflow-hidden rounded-2xl shadow-card"
      aria-label={category.name[locale] || category.name.bn}
    >
      {category.imageUrl ? (
        <StoreImage
          src={category.imageUrl}
          alt={category.name[locale] || category.name.bn}
          preset="hero"
          fillParent
          imgClassName="transition duration-300 group-hover:scale-[1.04]"
        />
      ) : (
        <span aria-hidden="true" className="brand-soft-gradient absolute inset-0" />
      )}
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 block p-4">
        <span className="block font-display text-base font-extrabold leading-snug text-white">
          {category.name[locale] || category.name.bn}
        </span>
        <span className="mt-0.5 block text-xs text-white/85">
          <CategoryCount category={category} />
        </span>
      </span>
    </Link>
  );
}

/** The last-resort tile when neither slides nor categories fill it. */
function AllCategoriesTile() {
  const { locale } = useLocale();
  const s = pick(locale, CIRCUIT_STRINGS);
  return (
    <Link
      href="/shop"
      className="brand-soft-gradient group relative block min-h-[120px] flex-1 overflow-hidden rounded-2xl shadow-card"
    >
      <span className="absolute inset-x-0 bottom-0 block p-4">
        <span className="block font-display text-base font-extrabold leading-snug text-text-main">
          {s.sideAllCategories}
        </span>
        <span className="mt-0.5 block text-xs text-text-muted">{s.sideAllCategoriesSub}</span>
      </span>
    </Link>
  );
}

export default function CircuitHomeHero({
  slides,
  categories,
}: {
  slides: HeroSlide[];
  categories: Category[];
}) {
  const { locale } = useLocale();
  const str = pick(locale, CIRCUIT_STRINGS);
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

  // The two stacked tiles: extra slides first, then real
  // categories, then the all-categories tile — always real links.
  const tiles: ReactNode[] = [];
  if (slides[1]) tiles.push(<SlideTile key={`slide-${slides[1].id}`} slide={slides[1]} />);
  if (slides[2]) tiles.push(<SlideTile key={`slide-${slides[2].id}`} slide={slides[2]} />);
  for (const c of categories) {
    if (tiles.length >= 2) break;
    tiles.push(<CategoryTile key={`cat-${c.slug}`} category={c} />);
  }
  while (tiles.length < 2) {
    tiles.push(<AllCategoriesTile key={`all-${tiles.length}`} />);
  }

  return (
    <section
      aria-label={str.heroHighlightAria}
      className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
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
                className="flex h-11 w-7 items-center justify-center"
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
      <div className="flex min-w-0 flex-col gap-3">{tiles.slice(0, 2)}</div>
    </section>
  );
}
