"use client";

/**
 * Boighor PDP gallery (doc 27 T-C) — client island: a vertical
 * thumbnail rail (active thumb = blue border) beside a large
 * bordered main image with prev/next arrows. The stage keeps the
 * package's PORTRAIT feel: a 3:4 frame, like a book cover on a
 * shelf. On small screens the rail moves under the stage as a
 * horizontal strip.
 *
 * Presentation only: the images are the product's own public
 * image list, passed in as serialisable props by the server
 * composition. With no catalogue imagery it renders our
 * book-outline placeholder — never a broken image.
 *
 * Doc 32 P2: the rail anatomy stays this package's own (the
 * vertical rail + portrait stage IS the Boighor signature), but
 * stage and thumbs now render through the shared StoreImage —
 * the first stage image gets next/image priority (the PDP's
 * LCP element), the 3:4 aspect is the preset contract (zero
 * CLS), and alt text resolves from the catalog alt fields
 * exactly as the hand-rolled <img> did.
 */
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { StoreImage } from "@/storefront-ux/components/StoreImage";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BOIGHOR_STRINGS } from "./strings";

export interface BoighorGalleryImage {
  url: string;
  altBn: string;
  altEn: string;
}

function BookPlaceholder() {
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
      <path d="M6 3.5h13.5v15H6.8a2.3 2.3 0 0 0-2.3 2.3V6a2.5 2.5 0 0 1 1.5-2.5Z" />
      <path d="M4.5 20.8A2.3 2.3 0 0 1 6.8 18.5h12.7" />
      <path d="M9 8h6.5" />
      <path d="M9 11.5h6.5" />
    </svg>
  );
}

export default function BoighorPdpGallery({
  images,
  titleBn,
  titleEn,
}: {
  images: BoighorGalleryImage[];
  titleBn: string;
  titleEn: string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, BOIGHOR_STRINGS);
  const [selected, setSelected] = useState(0);
  const current = images[selected] ?? images[0];

  if (!current) {
    return (
      <div className="flex aspect-[3/4] items-center justify-center rounded-lg border border-border bg-muted text-primary/40">
        <BookPlaceholder />
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
          className="flex gap-2 overflow-x-auto sm:max-h-[560px] sm:w-[76px] sm:shrink-0 sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden"
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

      {/* Main stage — portrait 3:4 */}
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        <StoreImage
          key={current.url}
          image={current}
          title={locale === "en" ? titleEn || titleBn : titleBn}
          preset="gallery"
          aspectClassName="aspect-[3/4]"
          priority={selected === 0}
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
