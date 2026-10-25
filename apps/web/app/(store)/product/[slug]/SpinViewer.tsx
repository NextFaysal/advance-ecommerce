"use client";

// 360° spin viewer — Wave 15-3 (doc 16 §P7), standalone client
// component. The parent wires it into the PDP gallery column when a
// product has enough frames (≥6 images) and module.product_extras is
// ON — this file deliberately knows nothing about flags or the PDP.
//
// Behaviour: drag (pointer) or swipe horizontally to cycle frames
// with wraparound; ~14px of travel = one frame, so a full drag across
// the stage spins the product around. Arrow keys work when focused.
// `touch-action: pan-y` keeps vertical page scroll intact on mobile.
// With 0 images it renders nothing; with 1 it degrades to a plain
// <img> — the graceful fallback, no fake spin controls.
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

const PX_PER_FRAME = 14;

export interface SpinViewerProps {
  images: string[];
  title: string;
}

export function SpinViewer({ images, title }: SpinViewerProps) {
  const [index, setIndex] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const drag = useRef<{ startX: number; startIndex: number; active: boolean }>({
    startX: 0,
    startIndex: 0,
    active: false,
  });

  if (images.length === 0) return null;

  const count = images.length;
  const wrap = (i: number) => ((i % count) + count) % count;
  const current = images[wrap(index)] as string;

  if (count === 1) {
    return (
      <div className="overflow-hidden rounded-3xl border border-border shadow-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} alt={title} className="aspect-[4/5] w-full object-cover" />
      </div>
    );
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startIndex: index, active: true };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    const steps = Math.round((drag.current.startX - e.clientX) / PX_PER_FRAME);
    if (steps !== 0) setInteracted(true);
    setIndex(wrap(drag.current.startIndex + steps));
  };
  const endDrag = () => {
    drag.current.active = false;
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      setInteracted(true);
      setIndex((i) => wrap(i + 1));
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      setInteracted(true);
      setIndex((i) => wrap(i - 1));
      e.preventDefault();
    }
  };

  return (
    <div
      role="img"
      aria-label={`${title} — 360° ভিউ, টেনে ঘোরান`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="relative cursor-grab select-none overflow-hidden rounded-3xl border border-border shadow-card outline-none focus:ring-2 focus:ring-brand-300 active:cursor-grabbing"
      style={{ touchAction: "pan-y" }}
    >
      {/* Preload every frame so dragging never flashes a blank stage. */}
      <span className="hidden" aria-hidden="true">
        {images.map((src) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt="" />
        ))}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current}
        alt={title}
        draggable={false}
        className="pointer-events-none aspect-[4/5] w-full object-cover"
      />
      <span className="brand-gradient absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold text-white shadow-md">
        360°
      </span>
      <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 font-mono text-xs text-white backdrop-blur-sm">
        {wrap(index) + 1} / {count}
      </span>
      {!interacted ? (
        <span className="absolute inset-x-0 bottom-3 flex justify-center">
          <span className="animate-pulse rounded-full bg-black/60 px-3.5 py-2 text-xs font-medium text-white backdrop-blur-sm">
            ↔ টেনে ঘোরান
          </span>
        </span>
      ) : (
        <span className="absolute bottom-3 left-3 flex gap-2">
          <button
            type="button"
            aria-label="আগের ফ্রেম"
            onClick={() => setIndex((i) => wrap(i - 1))}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-lg text-white backdrop-blur-sm transition duration-200 hover:bg-black/75 active:scale-95"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="পরের ফ্রেম"
            onClick={() => setIndex((i) => wrap(i + 1))}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-lg text-white backdrop-blur-sm transition duration-200 hover:bg-black/75 active:scale-95"
          >
            ›
          </button>
        </span>
      )}
    </div>
  );
}
