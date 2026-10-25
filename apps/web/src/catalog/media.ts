// Media pipeline — Agent 8 (Step 9 contract); real uploads landed in
// P1 (doc 16): POST /api/v1/admin/products/upload presigns direct-to-
// storage PUT URLs and the admin editor uploads the bytes itself, so
// this module stays the pure, client-safe contract:
//  - R2/S3 key layout, CDN URL derivation, variant derivation names
//  - sortOrder reorder (drag-reorder in admin), per-variant image pick
//  - validation: allowed types, max size, alt text required for SEO
// The SERVER half (storage config resolution from Admin Settings +
// SigV4 presigning, credentials never leave the server) lives in
// ./media-server.ts — the same pure/server split as platform/push.ts
// vs push-server.ts. WebP/AVIF re-encode + thumbnail variants remain a
// storage-adapter concern; the original file is what gets stored.

export interface MediaVariant {
  /** e.g. "thumb" 320w, "medium" 800w, "large" 1600w, "original" */
  name: "thumb" | "medium" | "large" | "original";
  url: string;
  width: number;
  format: "webp" | "avif" | "original";
}

export interface MediaAsset {
  key: string; // R2 object key, e.g. products/<productId>/<file>.webp
  originalUrl: string;
  cdnUrl: string;
  altBn: string;
  altEn: string;
  sortOrder: number;
  variants: MediaVariant[];
}

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB original, before encode

/** Direct-upload cap enforced by the P1 upload endpoint: the declared
 *  size is signed into the presigned URL (content-length is a signed
 *  header), so storage itself rejects an oversize PUT. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB per uploaded file
export const UPLOAD_EXPIRES_SECONDS = 900; // presigned PUT lifetime: 15 min
export const MAX_UPLOADS_PER_REQUEST = 10;

export function isAllowedImageMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}

export function validateMediaFile(input: { mime: string; sizeBytes: number; altBn: string; altEn: string }): string[] {
  const errors: string[] = [];
  if (!ALLOWED_MIME.has(input.mime)) errors.push(`Unsupported image type: ${input.mime}`);
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_IMAGE_BYTES) errors.push("Image must be > 0 and <= 10 MB");
  if (!input.altBn.trim() && !input.altEn.trim()) errors.push("Alt text (bn or en) is required");
  return errors;
}

/** R2 key layout — deterministic, no user input in the path except a slugified filename. */
export function buildR2Key(productSlug: string, filename: string): string {
  const safe = filename.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `products/${productSlug}/${Date.now()}-${safe || "image"}`;
}

/**
 * Derive CDN URLs for one stored asset. This is a pure URL builder:
 * it does NOT upload, encode, or call R2. The storage adapter must
 * produce exactly these variant files (WebP primary, AVIF where the
 * encoder supports it) or the storefront will 404 on a variant URL.
 */
export function buildMediaVariants(input: {
  cdnBaseUrl: string; // from Admin > Settings > Storage (CDN URL), env fallback only
  key: string; // R2 key without extension handling — base name
  altBn: string;
  altEn: string;
  sortOrder: number;
}): MediaAsset {
  const base = input.cdnBaseUrl.replace(/\/+$/, "");
  const stem = input.key.replace(/\.[a-z0-9]+$/i, "");
  const variants: MediaVariant[] = [
    { name: "thumb", url: `${base}/${stem}-thumb.webp`, width: 320, format: "webp" },
    { name: "medium", url: `${base}/${stem}-medium.webp`, width: 800, format: "webp" },
    { name: "large", url: `${base}/${stem}-large.webp`, width: 1600, format: "webp" },
    { name: "original", url: `${base}/${input.key}`, width: 0, format: "original" },
  ];
  return {
    key: input.key,
    originalUrl: `${base}/${input.key}`,
    cdnUrl: `${base}/${stem}-medium.webp`,
    altBn: input.altBn,
    altEn: input.altEn,
    sortOrder: input.sortOrder,
    variants,
  };
}

/** Drag-reorder: given ordered image ids, return new sortOrder values (0..n-1). */
export function reorderImages(orderedIds: string[]): { id: string; sortOrder: number }[] {
  return orderedIds.map((id, index) => ({ id, sortOrder: index }));
}

/** Per-variant image: variant imageUrl wins, otherwise first product image, otherwise null. */
export function resolveVariantImage(
  variantImageUrl: string | null,
  productImages: { url: string; sortOrder: number }[],
): string | null {
  if (variantImageUrl) return variantImageUrl;
  const sorted = [...productImages].sort((a, b) => a.sortOrder - b.sortOrder);
  return sorted[0]?.url ?? null;
}

/** Signed-upload request shape (storage adapter implements it; no key here). */
export interface SignedUploadRequest {
  productSlug: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}
export interface SignedUploadResponse {
  /** Client uploads directly to this URL; server never proxies the bytes. */
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
}

/** Digital product files (wave 15): NOT public assets — no publicUrl
 *  exists for them; buyers reach bytes only through a DownloadGrant.
 *  The editor stores `storageKey` (+ filename/size) on the product via
 *  the normal create/PATCH payloads. */
export const MAX_DIGITAL_FILE_BYTES = 200 * 1024 * 1024; // 200 MB per digital file
export const MAX_DIGITAL_UPLOADS_PER_REQUEST = 10;
export const DIGITAL_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/pdf",
  "application/epub+zip",
  "application/octet-stream",
]);

export function isAllowedDigitalMime(contentType: string): boolean {
  return DIGITAL_MIME_TYPES.has((contentType ?? "").toLowerCase());
}

/** One digital file's presigned upload ticket (wave 15). */
export interface DigitalUploadTicket {
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** The object key — stored as DigitalFile.storageKey. */
  storageKey: string;
  /** Presigned PUT URL; the PUT must carry the SAME Content-Type and
   *  Content-Length (both are signed). */
  uploadUrl: string;
  expiresInSeconds: number;
}

/** One file's presigned direct-upload ticket (P1 upload endpoint). */
export interface PresignedUploadTicket extends SignedUploadResponse {
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Final public URL of the object once the PUT succeeds — this is
   *  what gets stored in ProductImage.url / Product.ogImage. */
  publicUrl: string;
}
