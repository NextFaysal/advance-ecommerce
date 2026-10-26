/**
 * Courses config — ADV-23 vertical 6 (doc 23, wave 56).
 *
 * Storage: ONE Setting document, key `courses.config`, holding
 *   { courseVariantIds }
 * written with the established doc-store mechanism (direct
 * prisma.setting.upsert + invalidateSettingCache — the generic
 * setSetting() path rejects keys outside SETTING_DEFAULTS, the
 * same reason boxes.config / pod.config have their own stores).
 *
 * THE COURSE MARKER: exactly like the sibling verticals' config
 * lists (services.serviceVariantIds, boxes.boxVariantIds,
 * pod.podVariantIds) — a variant IS a course variant while its id
 * is on `courseVariantIds`. The CONTENT is per PRODUCT (one course
 * = one product, possibly sold through several listed variants —
 * e.g. a standard and a bundle-priced variant): buying ANY listed
 * variant of a product grants access to that product's course.
 * One list, read everywhere (PDP, account, player, admin), no
 * schema change.
 *
 * FAIL-SOFT READS (the config-store contract): a missing doc, a
 * corrupt doc, or a DB error resolves to the code defaults — an
 * EMPTY courseVariantIds list (nothing is a course until the
 * merchant lists variants; the fail-soft default can never invent
 * a course).
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";

export const COURSES_CONFIG_KEY = "courses.config";

/** The plain object schema (no refinements) — the admin config
 *  route extends THIS with its `reason` field. */
export const coursesConfigObjectSchema = z.object({
  /** Variants that sell a course (the v1 course marker). */
  courseVariantIds: z.array(z.string().trim().min(1)).max(200).default([]),
});

export const coursesConfigSchema = coursesConfigObjectSchema;

export type CoursesConfig = z.infer<typeof coursesConfigObjectSchema>;

export const DEFAULT_COURSES_CONFIG: CoursesConfig = {
  courseVariantIds: [],
};

/** De-duplicate the variant list (first occurrence wins), applied
 *  at save AND at read so a hand-edited doc cannot smuggle
 *  duplicates in either. */
function clean(config: CoursesConfig): CoursesConfig {
  return {
    courseVariantIds: [
      ...new Set(config.courseVariantIds.map((v) => v.trim()).filter((v) => v !== "")),
    ],
  };
}

export interface LoadedCoursesConfig {
  /** The stored (or default) document, as saved. */
  config: CoursesConfig;
  /** "saved" = merchant doc; "default" = code defaults (no doc, or doc failed validation). */
  source: "saved" | "default";
  /** What consumers honour (identical shape in v1 — kept as a
   *  separate field so the config API mirrors the sibling ones). */
  effective: CoursesConfig;
}

function toLoaded(config: CoursesConfig, source: "saved" | "default"): LoadedCoursesConfig {
  const cleaned = clean(config);
  return { config: cleaned, source, effective: { ...cleaned } };
}

/** The stored config with defaults fallback — never throws. */
export async function loadCoursesConfig(): Promise<LoadedCoursesConfig> {
  let raw: string | null = null;
  try {
    raw = await getSetting(COURSES_CONFIG_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed = coursesConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return toLoaded(parsed.data, "saved");
    } catch {
      // Corrupt JSON — fall through to defaults (documented above).
    }
  }
  return toLoaded(DEFAULT_COURSES_CONFIG, "default");
}

/** Persist a validated config (the admin route validates first).
 *  Throws on DB failure — the route reports 503 rather than
 *  claiming a save that did not happen. */
export async function saveCoursesConfig(config: CoursesConfig, actorId: string): Promise<void> {
  const value = JSON.stringify(clean(config));
  await prisma.setting.upsert({
    where: { key: COURSES_CONFIG_KEY },
    create: {
      key: COURSES_CONFIG_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "Courses (LMS-lite) config document (JSON, ADV-23)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(COURSES_CONFIG_KEY);
}

export function isCourseVariantId(config: CoursesConfig, variantId: string): boolean {
  return config.courseVariantIds.includes(variantId);
}
