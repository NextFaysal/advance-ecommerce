/**
 * Courses / LMS-lite module flag — ADV-23 vertical 6 (doc 23,
 * wave 56), the LAST ADV-23 vertical.
 *
 * Courses are a LAYER on the existing DIGITAL product machinery
 * (wave 15, src/catalog/product-types.ts): a course is an ordinary
 * DIGITAL product variant whose id is listed in
 * courses.config.courseVariantIds, bought through the unchanged
 * checkout. This flag gates ONLY the course layer — the PDP outline,
 * the "আমার কোর্স" account pages, the player, and the admin courses
 * page. The admin config/content APIs stay reachable without it
 * (settings/products-guarded, the sibling config precedent) so a
 * merchant can prepare courses before enabling the paid module.
 *
 * The flag DEFINITION is registered centrally by the parent in BOTH
 * src/lib/feature-flags.ts (FEATURE_FLAG_DEFINITIONS) and
 * packages/db/prisma/seed.ts (FEATURE_FLAGS), descriptions
 * identical:
 *
 *   { key: "module.courses", description: "Courses / LMS-lite: sell DIGITAL course variants, buyers get order-derived access to module/lesson content (v2 add-on, ADV-23)" }
 *
 * Until that registration lands, isFeatureEnabled() returns false —
 * the layer fails CLOSED, the correct pre-launch state.
 */
import { isFeatureEnabled } from "@/lib/feature-flags";

export const COURSES_FLAG = "module.courses";

export function coursesEnabled(): boolean {
  return isFeatureEnabled(COURSES_FLAG);
}
