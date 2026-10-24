"use client";

// PDP image gallery — client island for thumbnail switching + hover
// zoom. Presentation only: images come from the product's public shape.
// With no catalog imagery it renders a designed tinted placeholder
// (never a broken image or a dev-note box).
import { useState } from "react";

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
  const current = images[selected] ?? images[0];

  if (!current) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center rounded-3xl bg-gradient-to-br from-brand-50 via-surface-2 to-violet-500/10 text-brand-300 shadow-sm">
        <BagIcon />
      </div>
    );
  }

  return (
    <div>
      <div className="group aspect-[4/5] overflow-hidden rounded-3xl bg-surface-2 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.altBn || titleBn}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-110"
        />
      </div>
      {images.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {images.map((img, i) => (
            <button
              key={`${img.url}-${i}`}
              type="button"
              onClick={() => setSelected(i)}
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
      ) : null}
    </div>
  );
}
