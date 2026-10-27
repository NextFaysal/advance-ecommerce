"use client";

/**
 * Neel home hero (doc 27 T-E) — client island.
 *
 * A large carousel on the left and a 2×2 promo tile grid on the
 * right. The carousel cycles the store's OWN CMS hero slides
 * (Admin → Content); the promo tiles are the store's REAL
 * categories (image or initial tile, real /shop?category= links).
 * The tile grid is gated by the package's `showPromoTiles`
 * merchant option — off, the carousel takes the full row.
 *
 * Graceful degradation, nothing faked: with fewer than four
 * categories the remaining tile slots fall back to further CMS
 * slides, then to a single "all products" tile; with no slides
 * at all the main slot is our own static promo panel. Every
 * image, headline and link comes from CMS data or the live
 * category list passed in as props.
 *
 * Auto-advance pauses on hover/focus; dot indicators double as
 * the slide picker.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDigitText } from "@/components/ui/numerals";
import type { Category } from "@/catalog/types";
import type { HeroSlide } from "@/cms/site-content-types";
import { useThemeView } from "../theme-view";

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
          <span className="mt-4 inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-bold text-white shadow-md transition hover:opacity-90">
            {slide.ctaLabelBn}
          </span>
        ) : null}
      </span>
    </>
  );
  const cls =
    "relative block h-full min-h-[240px] w-full overflow-hidden rounded-2xl shadow-card sm:min-h-[320px]";
  return slide.ctaHref ? (
    <Link href={slide.ctaHref} className={cls} aria-label={slide.headlineBn}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Static fallback panel — our own copy, shown only while the
 *  store has no active CMS hero slides. */
function StaticPanel() {
  return (
    <div className="brand-soft-gradient relative block h-full min-h-[240px] w-full overflow-hidden rounded-2xl shadow-card sm:min-h-[320px]">
      <span aria-hidden="true" className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-primary/10" />
      <span aria-hidden="true" className="absolute -bottom-14 -left-8 h-52 w-52 rounded-full bg-primary/5" />
      <span className="absolute inset-x-0 bottom-0 block p-5 sm:p-7">
        <span className="block max-w-lg font-display text-xl font-extrabold leading-snug text-text-main sm:text-3xl">
          যা দরকার, সব এক ছাদের নিচে
        </span>
        <span className="mt-1.5 block max-w-md text-sm leading-6 text-text-muted">
          ফ্যাশন, ইলেকট্রনিক্স, ঘরোয়া পণ্য — পরিষ্কার দামে, সারাদেশে ডেলিভারিসহ।
        </span>
        <Link
          href="/shop"
          className="mt-4 inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-bold text-white shadow-md transition hover:opacity-90"
        >
          সব পণ্য দেখুন
        </Link>
      </span>
    </div>
  );
}

/** One promo tile: a real category (image or initial tile). */
function CategoryTile({ category }: { category: Category }) {
  const digits = useDigitText();
  return (
    <Link
      href={`/shop?category=${category.slug}`}
      className="group relative block min-h-[112px] overflow-hidden rounded-xl shadow-card lg:min-h-0"
      aria-label={category.name.bn}
    >
      {category.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={category.imageUrl}
          alt={category.name.bn}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.05]"
        />
      ) : (
        <span aria-hidden="true" className="brand-soft-gradient absolute inset-0" />
      )}
      <span
        aria-hidden="true"
        className={`absolute inset-0 ${category.imageUrl ? "bg-gradient-to-t from-black/60 via-black/10 to-transparent" : ""}`}
      />
      <span className="absolute inset-x-0 bottom-0 block p-3">
        <span
          className={`block truncate font-display text-[15px] font-extrabold leading-snug ${
            category.imageUrl ? "text-white" : "text-text-main"
          }`}
        >
          {category.name.bn}
        </span>
        <span
          className={`mt-0.5 block text-[11px] ${category.imageUrl ? "text-white/85" : "text-text-muted"}`}
        >
          {digits(`${category.productCount}টি পণ্য`)} — দেখুন →
        </span>
      </span>
    </Link>
  );
}

/** A promo tile carrying a CMS slide (the fill when categories
 *  run out before the grid is full). */
function SlideTile({ slide }: { slide: HeroSlide }) {
  const inner = (
    <>
      {slide.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slide.imageUrl}
          alt={slide.headlineBn}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.05]"
        />
      ) : (
        <span aria-hidden="true" className="brand-soft-gradient absolute inset-0" />
      )}
      <span
        aria-hidden="true"
        className={`absolute inset-0 ${slide.imageUrl ? "bg-gradient-to-t from-black/60 via-black/10 to-transparent" : ""}`}
      />
      <span className="absolute inset-x-0 bottom-0 block p-3">
        <span
          className={`block truncate font-display text-[15px] font-extrabold leading-snug ${
            slide.imageUrl ? "text-white" : "text-text-main"
          }`}
        >
          {slide.headlineBn}
        </span>
      </span>
    </>
  );
  const cls = "group relative block min-h-[112px] overflow-hidden rounded-xl shadow-card lg:min-h-0";
  return slide.ctaHref ? (
    <Link href={slide.ctaHref} className={cls} aria-label={slide.headlineBn}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export default function NeelHomeHero({
  slides,
  categories,
}: {
  slides: HeroSlide[];
  categories: Category[];
}) {
  const themeView = useThemeView();
  const showPromoTiles = themeView.options.showPromoTiles !== false;
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

  // Promo tile slots: real categories first (up to four), then
  // any CMS slides beyond the carousel's first; a lone tile is
  // paired with an "all categories" tile below.
  const tiles: Array<
    | { kind: "category"; category: Category }
    | { kind: "slide"; slide: HeroSlide }
  > = [];
  for (const c of categories) {
    if (tiles.length >= 4) break;
    tiles.push({ kind: "category", category: c });
  }
  for (const s of slides.slice(1)) {
    if (tiles.length >= 4) break;
    tiles.push({ kind: "slide", slide: s });
  }

  return (
    <section
      aria-label="হাইলাইট"
      className={`mt-4 grid gap-3 ${showPromoTiles && tiles.length > 0 ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : ""}`}
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
          <div className="absolute bottom-4 right-5 flex items-center gap-1.5" role="tablist" aria-label="ব্যানার বেছে নিন">
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
                    i === index ? "w-6 bg-primary" : "w-2 bg-white/70 shadow-sm"
                  }`}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* 2×2 promo tile grid — real categories/slides only */}
      {showPromoTiles && tiles.length > 0 ? (
        <div className="grid min-w-0 grid-cols-2 gap-3">
          {tiles.map((t, i) =>
            t.kind === "category" ? (
              <CategoryTile key={`cat-${t.category.slug}`} category={t.category} />
            ) : (
              <SlideTile key={`slide-${t.slide.id}-${i}`} slide={t.slide} />
            ),
          )}
          {tiles.length === 1 ? (
            <Link
              href="/shop"
              className="brand-soft-gradient group relative block min-h-[112px] overflow-hidden rounded-xl shadow-card lg:min-h-0"
            >
              <span className="absolute inset-x-0 bottom-0 block p-3">
                <span className="block font-display text-[15px] font-extrabold leading-snug text-text-main">
                  সব ক্যাটাগরি
                </span>
                <span className="mt-0.5 block text-[11px] text-text-muted">
                  দোকানের সব পণ্য একসাথে দেখুন →
                </span>
              </span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
