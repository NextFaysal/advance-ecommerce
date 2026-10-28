"use client";

/**
 * Shobji PDP gallery (doc 27 theme T-B) — client island: a
 * vertical thumbnail rail (active thumb = purple border) beside a
 * large rounded main image with prev/next arrows — the platform's
 * standard PDP gallery anatomy, restyled for this package. On
 * small screens the rail moves under the stage as a horizontal
 * strip.
 *
 * Presentation only: the images are the product's own public image
 * list, passed in as serialisable props by the server composition.
 * With no catalog imagery it renders our basket-outline
 * placeholder — never a broken image.
 *
 * Doc 32 P2: the rail + arrows anatomy is unchanged, but the
 * frames now render through the shared StoreImage — the stage
 * image is next/image-optimised and the first image loads with
 * priority (the PDP's LCP element) instead of a raw <img>;
 * thumbs ride the same component's thumb preset.
 */
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { StoreImage } from "@/storefront-ux/components/StoreImage";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SHOBJI_STRINGS } from "./strings";

export interface ShobjiGalleryImage {
  url: string;
  altBn: string;
  altEn: string;
}

function BasketPlaceholder() {
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
      <path d="M4 9h16l-1.4 9.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8L4 9Z" />
      <path d="M8 9l3.2-5.2M16 9l-3.2-5.2" />
      <path d="M9.2 13v3.4M12 13v3.4M14.8 13v3.4" />
    </svg>
  );
}

export default function ShobjiPdpGallery({
  images,
  titleBn,
  titleEn,
}: {
  images: ShobjiGalleryImage[];
  titleBn: string;
  titleEn: string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, SHOBJI_STRINGS);
  const [selected, setSelected] = useState(0);
  const current = images[selected] ?? images[0];

  if (!current) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-xl border border-border bg-muted text-primary/40">
        <BasketPlaceholder />
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
              className={`relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded-lg border-2 bg-card transition duration-200 ${
                i === selected
                  ? "border-primary shadow-card"
                  : "border-border opacity-75 hover:border-primary/50 hover:opacity-100"
              }`}
            >
              <StoreImage image={img} alt="" preset="thumb" fillParent />
            </button>
          ))}
        </div>
      ) : null}

      {/* Main stage — square box; the shared StoreImage fills it,
          alt resolved from the catalog fields with the
          locale-picked title as fallback, exactly as the raw
          <img> resolved it before. */}
      <div className="relative aspect-square min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
        <StoreImage
          image={current}
          title={locale === "en" ? titleEn || titleBn : titleBn}
          preset="gallery"
          fillParent
          priority={selected === 0}
        />
        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={s.prevImageAria}
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-card/95 text-text-main shadow-pop transition hover:bg-card hover:text-primary"
            >
              <Icon name="chevron-right" size={18} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={s.nextImageAria}
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
