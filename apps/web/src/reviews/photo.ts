/**
 * Photo reviews — availability probe (ADV-16, doc 22). Server-only.
 *
 * Photo review UPLOADS are not wired yet. The persistence blocker
 * cleared in wave 39 (Review.images exists and stored images render
 * on the PDP since ADV-16b); two gates remain:
 *
 * 1. STORAGE_NOT_CONFIGURED — uploads sign through the catalog media
 *    seam (src/catalog/media-server.ts), which refuses with
 *    STORAGE_NOT_CONFIGURED until R2/S3 credentials exist in Admin
 *    Settings (storage.*). There is no local-disk fallback.
 * 2. PERSISTENCE_NOT_ENABLED (legacy code name) — even with storage
 *    configured, no review-upload endpoint returns a URL for the
 *    form to attach yet; that endpoint is a future slice.
 *
 * Until both clear, the PDP form renders the attach control DISABLED
 * with the honest reason below. No upload is attempted and no
 * placeholder image URL is ever rendered for a review.
 */
import { isStorageConfigured } from "@/catalog/media-server";

export interface ReviewPhotoStatus {
  /** Always false today — see the header for the two blockers. */
  available: boolean;
  code: "STORAGE_NOT_CONFIGURED" | "PERSISTENCE_NOT_ENABLED";
  /** Customer-facing Bangla explanation of why photos are off. */
  reasonBn: string;
}

export async function getReviewPhotoStatus(): Promise<ReviewPhotoStatus> {
  const storageReady = await isStorageConfigured().catch(() => false);
  if (!storageReady) {
    return {
      available: false,
      code: "STORAGE_NOT_CONFIGURED",
      reasonBn:
        "ছবিসহ রিভিউ এখনো চালু হয়নি — ছবি রাখার স্টোরেজ (R2/S3) এখনো কনফিগার করা হয়নি।",
    };
  }
  return {
    available: false,
    code: "PERSISTENCE_NOT_ENABLED",
    reasonBn:
      "ছবিসহ রিভিউ এখনো চালু হয়নি — রিভিউয়ের ছবি আপলোডের সংযোগ শীঘ্রই আসছে।",
  };
}
