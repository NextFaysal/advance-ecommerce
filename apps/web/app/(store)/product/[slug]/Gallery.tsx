"use client";

// PDP image gallery — client island. Design v3 (§3): the stage is a
// scroll-snap carousel, so on mobile shoppers swipe between photos
// with dot indicators; on sm+ the thumbnail rail stays and the stage
// keeps its hover zoom. Presentation only: images come from the
// product's public shape. With no catalog imagery it renders a
// designed tinted placeholder (never a broken image or a dev-note box).
import { useRef, useState } from "react";

export interface GalleryImage {
  url: string;
  altBn: string;
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

export function Gallery({ images, titleBn }: { images: GalleryImage[]; titleBn: string }) {
  const [selected, setSelected] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const current = images[selected] ?? images[0];

  if (!current) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center rounded-3xl bg-gradient-to-br from-brand-50 via-surface-2 to-violet-500/10 text-brand-300 shadow-sm">
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
    <div>
      {/* Swipeable stage — scroll-snap carousel (dots on mobile,
          thumbnails on sm+); hover zoom preserved on large screens. */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-3xl bg-surface-2 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="পণ্যের ছবি"
      >
        {images.map((img, i) => (
          <div key={`${img.url}-${i}`} className="group aspect-[4/5] w-full shrink-0 snap-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.altBn || titleBn}
              loading={i === 0 ? undefined : "lazy"}
              className="h-full w-full object-cover transition duration-300 lg:group-hover:scale-110"
            />
          </div>
        ))}
      </div>

      {images.length > 1 ? (
        <>
          {/* Dot indicators — mobile only */}
          <div className="mt-1 flex items-center justify-center sm:hidden" role="tablist" aria-label="ছবি বেছে নিন">
            {images.map((img, i) => (
              <button
                key={`${img.url}-dot-${i}`}
                type="button"
                role="tab"
                onClick={() => goTo(i)}
                aria-label={`ছবি ${i + 1} দেখুন`}
                aria-selected={i === selected}
                className="flex h-11 w-9 items-center justify-center"
              >
                <span
                  aria-hidden="true"
                  className={`h-2 rounded-full transition-all duration-200 ${
                    i === selected ? "w-6 bg-brand-600" : "w-2 bg-border"
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Thumbnails — sm and up */}
          <div className="mt-3 hidden flex-wrap gap-2.5 sm:flex">
            {images.map((img, i) => (
              <button
                key={`${img.url}-${i}`}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`ছবি ${i + 1} দেখুন`}
                aria-pressed={i === selected}
                className={`h-20 w-16 overflow-hidden rounded-xl border-2 transition ${
                  i === selected ? "border-brand-600 shadow-sm" : "border-transparent opacity-70 hover:opacity-100"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
