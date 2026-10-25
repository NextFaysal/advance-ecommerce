/**
 * PDP product video (Wave 14-2, doc 16 §P5). Renders only for https
 * URLs: YouTube / Vimeo pages become their official embed players,
 * direct .mp4/.webm files become a native <video>, and any other
 * https link degrades to a plain outbound link — an unrecognised URL
 * is never iframed blindly, and a non-https URL renders nothing.
 */

function embedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();

  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
    return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : null;
  }
  if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
    const v = url.searchParams.get("v");
    if (v) return `https://www.youtube.com/embed/${encodeURIComponent(v)}`;
    const m = url.pathname.match(/^\/(?:embed|shorts)\/([^/?#]+)/);
    if (m?.[1]) return `https://www.youtube.com/embed/${encodeURIComponent(m[1])}`;
    return null;
  }
  if (host === "vimeo.com" || host === "www.vimeo.com") {
    const m = url.pathname.match(/^\/(\d+)/);
    return m?.[1] ? `https://player.vimeo.com/video/${m[1]}` : null;
  }
  if (host === "player.vimeo.com") {
    const m = url.pathname.match(/^\/video\/(\d+)/);
    return m?.[1] ? `https://player.vimeo.com/video/${m[1]}` : null;
  }
  return null;
}

function isDirectFile(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /\.(mp4|webm)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function ProductVideo({ videoUrl, titleBn }: { videoUrl: string; titleBn: string }) {
  const embed = embedUrl(videoUrl);
  if (embed) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-3xl border border-border bg-black shadow-sm">
        <iframe
          src={embed}
          title={`${titleBn} — ভিডিও`}
          className="h-full w-full"
          loading="lazy"
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }
  if (isDirectFile(videoUrl)) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-3xl border border-border bg-black shadow-sm">
        <video src={videoUrl} controls preload="metadata" className="h-full w-full" aria-label={`${titleBn} — ভিডিও`} />
      </div>
    );
  }
  if (/^https:\/\//i.test(videoUrl)) {
    return (
      <p className="rounded-3xl border border-border bg-card p-5 text-sm shadow-sm">
        <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
          🎬 পণ্যের ভিডিও দেখুন
        </a>
      </p>
    );
  }
  return null;
}
