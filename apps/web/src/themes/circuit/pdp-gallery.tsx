"use client";

/**
 * Circuit PDP gallery (doc 27 T-D) — client island: a vertical
 * thumbnail rail (active thumb = orange border) beside a large
 * bordered main image with prev/next arrows. On small screens the
 * rail moves under the stage as a horizontal strip.
 *
 * Presentation only: the images are the product's own public image
 * list, passed in as serialisable props by the server composition.
 * With no catalog imagery it renders our monitor-outline
 * placeholder — never a broken image.
 */
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { CIRCUIT_STRINGS } from "./strings";

export interface CircuitGalleryImage {
  url: string;
  altBn: string;
  altEn: string;
}

function DevicePlaceholder() {
  return (
    <svg
      width="76"
      height="76"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M9.5 20.5h5M12 16.5v4" />
    </svg>
  );
}

export default function CircuitPdpGallery({
  images,
  titleBn,
  titleEn,
}: {
  images: CircuitGalleryImage[];
  titleBn: string;
  titleEn: string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, CIRCUIT_STRINGS);
  const [selected, setSelected] = useState(0);
  const current = images[selected] ?? images[0];

  if (!current) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-xl border border-border bg-muted text-primary/40">
        <DevicePlaceholder />
      </div>
    );
  }

  const go = (dir: 1 | -1) => {
    setSelected((i) => ((i + dir) % images.length + images.length) % images.length);
  };

  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      {/* Thumbnail rail — horizontal strip on phones, vertical on sm+ */}
      {images.length > 1 ? (
        <div
          className="flex gap-2 overflow-x-auto sm:max-h-[520px] sm:w-[76px] sm:shrink-0 sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden"
          role="tablist"
          aria-label={s.galleryAria}
        >
          {images.map((img, i) => (
            <button
              key={`${img.url}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === selected}
              aria-label={interpolate(s.viewImageAria, { n: i + 1 })}
              onClick={() => setSelected(i)}
              className={`h-[68px] w-[68px] shrink-0 overflow-hidden rounded-lg border-2 bg-card transition duration-200 ${
                i === selected
                  ? "border-primary shadow-card"
                  : "border-border opacity-75 hover:border-primary/50 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}

      {/* Main stage */}
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={(locale === "en" ? current.altEn || current.altBn : current.altBn) || (locale === "en" ? titleEn || titleBn : titleBn)}
          className="aspect-square h-full w-full object-cover"
        />
        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={s.prevImage}
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-card/95 text-text-main shadow-pop transition hover:bg-card hover:text-primary"
            >
              <Icon name="chevron-right" size={18} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={s.nextImage}
              className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-card/95 text-text-main shadow-pop transition hover:bg-card hover:text-primary"
            >
              <Icon name="chevron-right" size={18} />
            </button>
            <span
              aria-hidden="true"
              className="absolute bottom-3 right-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white"
            >
              {selected + 1} / {images.length}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
