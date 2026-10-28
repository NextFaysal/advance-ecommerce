"use client";

/**
 * YouTube facade for the landing `video` block (doc 34 §3.2, L3).
 *
 * Click-to-load, privacy-enhanced: until the visitor taps, the page
 * carries only the video's thumbnail (through StoreImage's plain
 * mode — i.ytimg.com is not an optimizer-configured host) and NO
 * iframe, no YouTube cookies, no tracker weight (§5 decision 3:
 * YouTube only, youtube-nocookie host, no autoplay-on-load). The
 * tap swaps in the nocookie embed with autoplay=1 — the visitor's
 * own click is the play action.
 */
import { useState } from "react";
import { StoreImage } from "@/storefront-ux/components/StoreImage";

export function VideoFacade({
  videoId,
  title,
  playLabel,
}: {
  videoId: string;
  title: string;
  playLabel: string;
}) {
  const [loaded, setLoaded] = useState(false);
  if (loaded) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`}
          title={title || playLabel}
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      aria-label={playLabel}
      className="group relative block w-full overflow-hidden rounded-2xl text-left"
    >
      <StoreImage
        src={`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`}
        alt={title}
        preset="hero"
        aspectClassName="aspect-video"
        plain
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition group-hover:bg-black/35">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-2xl text-white shadow-lg" aria-hidden="true">
          ▶
        </span>
      </span>
    </button>
  );
}
