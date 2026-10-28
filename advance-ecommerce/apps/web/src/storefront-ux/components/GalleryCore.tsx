"use client";

/**
 * GalleryCore — the shared PDP gallery shell (doc 32 P1).
 *
 * Extracted from the platform Gallery (app/(store)/product/[slug]/
 * Gallery.tsx, design v3 + wave 17): a scroll-snap stage shoppers
 * swipe on mobile, dot indicators on phones, a thumbnail rail from
 * sm up, a glass position counter and a desktop hover-zoom
 * affordance. The behaviour is the Aurora reference behaviour; what
 * P1 changes is only the vehicle — slides and thumbs now render
 * through StoreImage, so the first stage image gets next/image
 * `priority` (the PDP's LCP element) and every frame carries the
 * preset's aspect contract.
 *
 * Composable, not monolithic: the stage aspect, the zoom behaviour
 * and the label set are props, so P2/P3 can dress the same core in
 * another theme's anatomy (Bazaar's rail + arrows, Boighor's
 * portrait stage…) without forking the swipe/scroll logic again.
 *
 * Copy stays with the caller: alt text arrives resolved per image
 * and every aria label arrives through `labels` — this component
 * owns no dictionary.
 */
import { useRef, useState } from "react";
import { StoreImage } from "./StoreImage";

export interface GalleryCoreImage {
  url: string;
  /** Alt text, already resolved to the active locale by the caller. */
  alt: string;
}

export interface GalleryCoreLabels {
  /** aria-label of the swipeable stage. */
  gallery: string;
  /** aria-label of the mobile dot tablist. */
  chooseImage: string;
  /** aria-label for the nth image control (dots + thumbs). */
  image: (n: number) => string;
}

function BagIcon() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 8h14l-1.2 12.1a1.5 1.5 0 0 1-1.5 1.4H7.7a1.5 1.5 0 0 1-1.5-1.4L5 8Z" />
      <path d="M8.5 10.5V6.8a3.5 3.5 0 0 1 7 0v3.7" />
    </svg>
  );
}

export function GalleryCore({
  images,
  title,
  labels,
  aspectClassName = "aspect-[4/5]",
  hoverZoom = true,
}: {
  images: GalleryCoreImage[];
  /** Product title — the stage images' alt fallback. */
  title: string;
  labels: GalleryCoreLabels;
  /** Stage aspect (Aurora PDP = 4:5 portrait). */
  aspectClassName?: string;
  /** Desktop hover scale on the stage image (Aurora behaviour). */
  hoverZoom?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const current = images[selected] ?? images[0];

  if (!current) {
    return (
      <div
        className={`flex ${aspectClassName} items-center justify-center rounded-3xl border border-border bg-gradient-to-br from-brand-50 via-surface-2 to-violet-500/10 text-brand-300 shadow-card`}
      >
        <BagIcon />
      </div>
    );
  }

  const goTo = (index: number) => {
    setSelected(index);
    const track = trackRef.current;
    if (track) track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    if (index !== selected && index >= 0 && index < images.length) setSelected(index);
  };

  return (
    <div className="group/gallery">
      {/* Swipeable stage — scroll-snap carousel (dots on mobile,
          thumbnails on sm+); hover zoom preserved on large screens.
          The stage sits in a framed, token-shadowed shell with a
          glass counter chip and a desktop-only zoom affordance. */}
      <div className="relative">
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory overflow-x-auto rounded-3xl border border-border bg-surface-2 shadow-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={labels.gallery}
        >
          {images.map((img, i) => (
            <div
              key={`${img.url}-${i}`}
              className={`group relative ${aspectClassName} w-full shrink-0 snap-center overflow-hidden`}
            >
              <StoreImage
                src={img.url}
                alt={img.alt || title}
                preset="gallery"
                aspectClassName={aspectClassName}
                fillParent
                priority={i === 0}
                imgClassName={
                  hoverZoom ? "transition duration-500 ease-out lg:group-hover:scale-110" : undefined
                }
              />
            </div>
          ))}
        </div>

        {images.length > 1 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm"
          >
            {selected + 1} / {images.length}
          </span>
        ) : null}

        {/* Zoom affordance — decorative, desktop hover only (the zoom
            itself is the CSS scale above; no copy, no behaviour). */}
        {hoverZoom ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-3 hidden h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition duration-300 group-hover/gallery:opacity-100 lg:flex"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.8-3.8" />
              <path d="M11 8.5v5M8.5 11h5" />
            </svg>
          </span>
        ) : null}
      </div>

      {images.length > 1 ? (
        <>
          {/* Dot indicators — mobile only */}
          <div className="mt-1 flex items-center justify-center sm:hidden" role="tablist" aria-label={labels.chooseImage}>
            {images.map((img, i) => (
              <button
                key={`${img.url}-dot-${i}`}
                type="button"
                role="tab"
                onClick={() => goTo(i)}
                aria-label={labels.image(i + 1)}
                aria-selected={i === selected}
                className="flex h-11 w-9 items-center justify-center"
              >
                <span
                  aria-hidden="true"
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === selected ? "brand-gradient w-6" : "w-2 bg-border"
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Thumbnails — sm and up */}
          <div className="mt-3.5 hidden flex-wrap gap-2.5 sm:flex">
            {images.map((img, i) => (
              <button
                key={`${img.url}-${i}`}
                type="button"
                onClick={() => goTo(i)}
                aria-label={labels.image(i + 1)}
                aria-pressed={i === selected}
                className={`relative h-20 w-16 overflow-hidden rounded-xl transition duration-200 ${
                  i === selected
                    ? "shadow-card ring-2 ring-brand-600 ring-offset-2 ring-offset-card"
                    : "opacity-70 ring-1 ring-border hover:opacity-100 hover:ring-brand-300"
                }`}
              >
                <StoreImage src={img.url} alt="" preset="thumb" fillParent />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
