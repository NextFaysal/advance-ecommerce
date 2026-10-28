"use client";

/**
 * StoreImage — the shared storefront image component (doc 32 P1).
 *
 * One wrapper over next/image for every single-page surface, so the
 * §5 discipline (named size presets, mandatory aspect ratio → zero
 * CLS from images, priority only where the caller says so) is
 * enforced in one place instead of per theme file. It accepts the
 * catalog image shape ({ url, altBn, altEn } — src/catalog/types
 * ProductImage) and resolves the alt text exactly the way the doc-30
 * sweep taught the themes to: an explicit `locale` prop wins,
 * otherwise the LocaleProvider context (this component is a client
 * island, so server compositions can render it directly); the alt
 * itself is `altEn || altBn` in English, `altBn` in Bangla, falling
 * back to the product `title` when both are empty.
 *
 * Escape hatch: `plain` renders a plain <img> inside the identical
 * aspect wrapper — for contexts where the Next image optimizer
 * cannot go (unconfigured remote hosts, blob:/data: previews). The
 * layout contract (aspect box, sizes, loading) is the same either
 * way, so swapping modes never shifts a page.
 *
 * Presentation only: no fetching, no state. Copy never lives here —
 * alt text arrives as data (catalog fields or the `alt` override).
 */
import Image from "next/image";
import type { ReactNode } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import type { Locale } from "@/i18n/locale";

/** The catalog image shape (structural subset of ProductImage). */
export interface StoreImageSource {
  url: string;
  altBn: string;
  altEn: string;
}

export type StoreImagePreset = "card" | "gallery" | "thumb" | "hero" | "square";

/**
 * Named presets: the aspect box (CLS contract) + the `sizes` the
 * optimizer is told to generate for. Callers pick a context, never
 * raw numbers — new contexts get a new preset here, once.
 */
export const STORE_IMAGE_PRESETS: Record<
  StoreImagePreset,
  { aspectClassName: string; sizes: string }
> = {
  /* Product cards in shop/search/home grids (portrait 4:5). */
  card: {
    aspectClassName: "aspect-[4/5]",
    sizes: "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
  },
  /* PDP stage — the money page's LCP element. */
  gallery: {
    aspectClassName: "aspect-[4/5]",
    sizes: "(max-width: 1024px) 100vw, 50vw",
  },
  /* Gallery thumbs, drawer/cart thumbs, mini-cards. */
  thumb: {
    aspectClassName: "aspect-square",
    sizes: "160px",
  },
  /* Full-width page heroes / banners. */
  hero: {
    aspectClassName: "aspect-[16/9]",
    sizes: "100vw",
  },
  /* Square tiles (category tiles, suggestion cards). */
  square: {
    aspectClassName: "aspect-square",
    sizes: "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
  },
};

function BagMark() {
  return (
    <svg
      width="56"
      height="56"
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

export function StoreImage({
  image,
  src,
  alt,
  title,
  preset = "card",
  locale: localeProp,
  priority = false,
  plain = false,
  fillParent = false,
  aspectClassName,
  sizes,
  fit = "cover",
  className = "",
  imgClassName = "",
  fallback,
}: {
  /** Catalog-shaped image (preferred). */
  image?: StoreImageSource | null;
  /** Raw URL form, when there is no catalog image record. */
  src?: string | null;
  /** Explicit alt — overrides the catalog alt fields entirely. */
  alt?: string;
  /** Fallback alt when the catalog alt fields are empty (product title). */
  title?: string;
  preset?: StoreImagePreset;
  /** Explicit locale for alt selection; defaults to the visitor's. */
  locale?: Locale;
  /** LCP discipline: only the PDP's first gallery image passes this. */
  priority?: boolean;
  /** Escape hatch: plain <img> in the same aspect wrapper. */
  plain?: boolean;
  /** Fill a positioned parent (gallery slides) instead of owning an aspect box. */
  fillParent?: boolean;
  aspectClassName?: string;
  sizes?: string;
  fit?: "cover" | "contain";
  className?: string;
  imgClassName?: string;
  /** Placeholder rendered when there is no image at all. */
  fallback?: ReactNode;
}) {
  const { locale: contextLocale } = useLocale();
  const locale = localeProp ?? contextLocale;

  const url = image?.url ?? src ?? null;
  const resolvedAlt =
    alt ??
    (image
      ? (locale === "en" ? image.altEn || image.altBn : image.altBn) || title || ""
      : title ?? "");

  const presetDef = STORE_IMAGE_PRESETS[preset];
  const wrapperClassName = fillParent
    ? `absolute inset-0 block overflow-hidden ${className}`
    : `relative block overflow-hidden ${aspectClassName ?? presetDef.aspectClassName} ${className}`;

  if (!url) {
    return (
      <span
        className={`${wrapperClassName} flex items-center justify-center bg-surface-2 text-brand-300`}
        aria-hidden="true"
      >
        {fallback ?? <BagMark />}
      </span>
    );
  }

  const fitClass = fit === "cover" ? "object-cover" : "object-contain";

  if (plain) {
    return (
      <span className={wrapperClassName}>
        {/* Plain mode is the documented escape hatch (see header). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={resolvedAlt}
          loading={priority ? undefined : "lazy"}
          className={`h-full w-full ${fitClass} ${imgClassName}`}
        />
      </span>
    );
  }

  return (
    <span className={wrapperClassName}>
      <Image
        src={url}
        alt={resolvedAlt}
        fill
        sizes={sizes ?? presetDef.sizes}
        priority={priority}
        className={`${fitClass} ${imgClassName}`}
      />
    </span>
  );
}
