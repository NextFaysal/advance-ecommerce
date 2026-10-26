/**
 * Course content documents — ADV-23 vertical 6 (doc 23, wave 56).
 *
 * Storage: ONE Setting document PER COURSE PRODUCT, key
 * `courses.content.<productId>`, holding
 *   { productId, modules: [{ title, lessons: [{ id, title, kind,
 *        videoUrl?, bodyMd?, externalUrl? }] }] }
 * via the same doc-store mechanism as courses.config.
 *
 * PRIVACY SHAPE — read this before touching a consumer: the FULL
 * document carries lesson BODIES (text markdown, video embed URLs).
 * Bodies are buyer-only data. The only projections that may leave
 * the server for a non-buyer are the OUTLINE shapes produced by
 * toCourseOutline() below (module/lesson titles + kinds + counts —
 * never videoUrl / bodyMd / externalUrl). The PDP outline and the
 * player's locked view both render from the outline projection;
 * the full document is loaded ONLY after the order-derived access
 * check in src/courses/service.ts passes.
 *
 * VIDEO URLs are stored already normalised to canonical embed URLs
 * (the admin contents route runs normalizeVideoEmbedUrl from
 * ./video and refuses any other host with a 400). The schema here
 * is structural only; the player re-validates at render time.
 *
 * FAIL-SOFT READS: a missing/corrupt doc resolves to null ("no
 * content authored yet") — the PDP then shows no outline section
 * and the player shows an honest "content not published yet"
 * notice rather than an empty shell pretending to be a course.
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";

export function courseContentKey(productId: string): string {
  return `courses.content.${productId}`;
}

export const LESSON_KINDS = ["video", "text", "link"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const MAX_MODULES = 20;
export const MAX_LESSONS_PER_MODULE = 50;
/** Text-lesson markdown cap (~20k chars, the brief's bound). */
export const MAX_LESSON_BODY_CHARS = 20_000;

export interface CourseLesson {
  id: string;
  title: string;
  kind: LessonKind;
  /** Canonical YouTube/Vimeo EMBED url (kind "video" only). */
  videoUrl?: string;
  /** Merchant markdown (kind "text" only) — rendered ONLY through
   *  renderDescriptionHtml (src/catalog/description.ts), the
   *  escape-first house renderer. */
  bodyMd?: string;
  /** http/https URL (kind "link" only). */
  externalUrl?: string;
}

export interface CourseModule {
  title: string;
  lessons: CourseLesson[];
}

export interface CourseContentDoc {
  productId: string;
  modules: CourseModule[];
}

const lessonSchema = z.object({
  id: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(LESSON_KINDS),
  videoUrl: z.string().trim().max(500).optional(),
  bodyMd: z.string().max(MAX_LESSON_BODY_CHARS).optional(),
  externalUrl: z.string().trim().max(500).optional(),
});

const moduleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  lessons: z.array(lessonSchema).max(MAX_LESSONS_PER_MODULE),
});

export const courseContentDocSchema = z.object({
  productId: z.string().trim().min(1),
  modules: z.array(moduleSchema).max(MAX_MODULES),
});

/** The stored content doc for one course product — null when no
 *  doc exists or the stored doc fails validation. Never throws. */
export async function loadCourseContent(productId: string): Promise<CourseContentDoc | null> {
  let raw: string | null = null;
  try {
    raw = await getSetting(courseContentKey(productId));
  } catch {
    raw = null;
  }
  if (!raw) return null;
  try {
    const parsed = courseContentDocSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.productId === productId) return parsed.data;
  } catch {
    // Corrupt JSON — treated as "no content authored yet".
  }
  return null;
}

/** Persist a validated content doc (the admin route validates +
 *  normalises video URLs first). Throws on DB failure. */
export async function saveCourseContent(doc: CourseContentDoc, actorId: string): Promise<void> {
  const key = courseContentKey(doc.productId);
  const value = JSON.stringify(doc);
  await prisma.setting.upsert({
    where: { key },
    create: {
      key,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: `Course content for product ${doc.productId} (JSON, ADV-23)`,
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(key);
}

/* ------------------------------------------------------------------ */
/* Outline projection — the ONLY shape a non-buyer may ever see      */
/* ------------------------------------------------------------------ */

export interface CourseLessonOutline {
  id: string;
  title: string;
  kind: LessonKind;
}

export interface CourseModuleOutline {
  title: string;
  lessons: CourseLessonOutline[];
}

export interface CourseOutline {
  modules: CourseModuleOutline[];
  totalLessons: number;
}

/** Strip a content doc to titles + kinds + counts. This is a
 *  deliberate field-by-field rebuild (never a spread of the lesson
 *  objects) so a future lesson field cannot leak by accident. */
export function toCourseOutline(doc: CourseContentDoc | null): CourseOutline | null {
  if (doc === null) return null;
  let totalLessons = 0;
  const modules = doc.modules.map((m) => {
    totalLessons += m.lessons.length;
    return {
      title: m.title,
      lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, kind: l.kind })),
    };
  });
  return { modules, totalLessons };
}
