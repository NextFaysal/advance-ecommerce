"use client";

// PDP image gallery — client island, now a thin adapter over the
// shared GalleryCore (src/storefront-ux/components, doc 32 P1).
// The behaviour is the one design v3 (§3) + wave 17 built here —
// scroll-snap swipe stage, mobile dots, sm+ thumbnail rail, glass
// counter, desktop hover zoom — unchanged; the core renders the
// frames through StoreImage, so the first stage image now loads
// with next/image priority (the PDP's LCP element) instead of a
// plain <img>. Presentation only: images come from the product's
// public shape; with no catalog imagery the core renders the same
// designed tinted placeholder as before.
//
// The aria labels below are the exact strings this component has
// always rendered (they predate the doc-30 dictionaries and no
// gallery keys exist in COMMON/AURORA strings yet) — they are now
// injected through GalleryCore's `labels` prop, so wiring real
// dictionary strings later is a one-line change here.
import { GalleryCore } from "@/storefront-ux/components/GalleryCore";

export interface GalleryImage {
  url: string;
  altBn: string;
}

export function Gallery({ images, titleBn }: { images: GalleryImage[]; titleBn: string }) {
  return (
    <GalleryCore
      images={images.map((img) => ({ url: img.url, alt: img.altBn }))}
      title={titleBn}
      labels={{
        gallery: "পণ্যের ছবি",
        chooseImage: "ছবি বেছে নিন",
        image: (n) => `ছবি ${n} দেখুন`,
      }}
    />
  );
}
