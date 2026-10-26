/**
 * Course video URL handling — ADV-23 vertical 6 (wave 56). PURE
 * (no imports), safe to use from client components, the admin API
 * and server renderers alike.
 *
 * Courses NEVER host video in v1: a video lesson is an EMBED of a
 * YouTube or Vimeo URL the merchant pastes. The merchant may paste
 * any of the common shapes (watch page, share link, embed URL);
 * this module normalises them to the canonical embed URL at SAVE
 * time (the admin contents route calls normalizeVideoEmbedUrl and
 * answers 400 for anything else). Only these hosts are allowed:
 *
 *   youtube.com / www.youtube.com / m.youtube.com / youtu.be
 *   vimeo.com / www.vimeo.com / player.vimeo.com
 *
 * The player additionally re-checks with isAllowedEmbedUrl at
 * RENDER time, so a hand-edited content doc can never smuggle an
 * arbitrary iframe origin onto a customer page.
 */

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

/** YouTube ids are 11 chars of [A-Za-z0-9_-]; Vimeo ids are digits. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,20}$/;

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

function youtubeEmbed(id: string): string | null {
  return YOUTUBE_ID.test(id) ? `https://www.youtube.com/embed/${id}` : null;
}

function vimeoEmbed(id: string): string | null {
  return VIMEO_ID.test(id) ? `https://player.vimeo.com/video/${id}` : null;
}

/**
 * Normalise a merchant-pasted video URL to its canonical embed
 * URL, or null when the URL is not a YouTube/Vimeo video URL on an
 * allowed host. Accepts:
 *   youtube.com/watch?v=<id> · youtu.be/<id> · youtube.com/embed/<id>
 *   youtube.com/shorts/<id> · youtube.com/live/<id>
 *   vimeo.com/<id> · player.vimeo.com/video/<id>
 * An already-canonical embed URL normalises to itself, so the
 * function is idempotent (the stored doc can be re-validated).
 */
export function normalizeVideoEmbedUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (url === null) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter((p) => p !== "");

  if (host === "youtu.be") {
    return parts.length >= 1 ? youtubeEmbed(parts[0] ?? "") : null;
  }
  if (YOUTUBE_HOSTS.has(host)) {
    if (parts[0] === "watch") {
      const id = url.searchParams.get("v");
      return id !== null ? youtubeEmbed(id) : null;
    }
    if ((parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") && parts[1]) {
      return youtubeEmbed(parts[1]);
    }
    return null;
  }
  if (VIMEO_HOSTS.has(host)) {
    if (host === "player.vimeo.com") {
      return parts[0] === "video" && parts[1] ? vimeoEmbed(parts[1]) : null;
    }
    // vimeo.com/<id> (an optional trailing slug segment is ignored)
    return parts.length >= 1 ? vimeoEmbed(parts[0] ?? "") : null;
  }
  return null;
}

/**
 * Render-time check: the stored URL is EXACTLY a canonical embed
 * URL on an allowed host (not merely normalisable). The player
 * refuses to iframe anything else.
 */
export function isAllowedEmbedUrl(raw: string): boolean {
  const url = parseUrl(raw);
  if (url === null || url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter((p) => p !== "");
  if (host === "www.youtube.com") {
    return parts[0] === "embed" && parts.length === 2 && YOUTUBE_ID.test(parts[1] ?? "");
  }
  if (host === "player.vimeo.com") {
    return parts[0] === "video" && parts.length === 2 && VIMEO_ID.test(parts[1] ?? "");
  }
  return false;
}
