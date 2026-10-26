/**
 * Admin course content API — /api/v1/admin/courses/contents
 * (ADV-23 vertical 6, doc 23 wave 56).
 *
 *   GET (no query)        -> the configured course products with
 *                            their listed variants + content status
 *                            (editor picker). Requires products.view.
 *   GET ?productId=<id>   -> that product's content document
 *                            (doc: null when none saved yet).
 *                            Requires products.view.
 *   PUT { productId, modules: [{ title, lessons: [{ id, title,
 *          kind, videoUrl?, bodyMd?, externalUrl? }] }], reason }
 *       -> whole-document replace for ONE course product. Requires
 *          products.edit + a non-empty `reason`; audited
 *          (courses.content.update) with before/after documents.
 *
 * Course content is CATALOG authoring, so this route guards on
 * products.* (the config route guards on settings.*) — the split
 * the vertical brief specifies.
 *
 * VIDEO HOSTS: a video lesson's URL is normalised through
 * normalizeVideoEmbedUrl (src/courses/video) and stored as the
 * canonical EMBED url. Any URL that is not a YouTube/Vimeo video
 * on an allowed host is a 400 INVALID_VIDEO_URL — arbitrary iframe
 * origins can never be authored into a course. Kind discipline is
 * enforced here too (video lessons carry ONLY videoUrl, text
 * lessons ONLY bodyMd, link lessons ONLY externalUrl, which must
 * be http/https): stray fields from the editor are dropped, never
 * stored.
 *
 * Content can only be saved for a product with at least one
 * variant listed in courses.config.courseVariantIds
 * (400 NOT_A_COURSE_PRODUCT otherwise): a doc for an unlisted
 * product would never be read by any surface, and saving one must
 * not pretend otherwise.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  MAX_LESSONS_PER_MODULE,
  MAX_MODULES,
  courseContentKey,
  loadCourseContent,
  saveCourseContent,
  type CourseContentDoc,
  type CourseModule,
} from "@/courses/content";
import { getCourseVariantIdsForProduct, listCourseProductSummaries } from "@/courses/service";
import { normalizeVideoEmbedUrl } from "@/courses/video";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: "products.view" | "products.edit") {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database.", 503) };
  }
}

export async function GET(req: Request) {
  const auth = await requireAdmin("products.view");
  if ("error" in auth) return auth.error;

  const productId = new URL(req.url).searchParams.get("productId");
  if (productId === null) {
    const products = await listCourseProductSummaries();
    return NextResponse.json({ data: { products }, meta: { persistence: "setting-doc" } });
  }

  const variantIds = await getCourseVariantIdsForProduct(productId);
  if (variantIds.length === 0) {
    return err(
      "NOT_A_COURSE_PRODUCT",
      "This product has no variant listed as a course in courses.config.",
      400,
    );
  }
  const doc = await loadCourseContent(productId);
  return NextResponse.json({
    data: {
      docKey: courseContentKey(productId),
      productId,
      doc,
      source: doc !== null ? "saved" : "default",
    },
    meta: { persistence: "setting-doc" },
  });
}

const putSchema = z.object({
  productId: z.string().trim().min(1),
  modules: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        lessons: z
          .array(
            z.object({
              id: z.string().trim().min(1).max(64),
              title: z.string().trim().min(1).max(200),
              kind: z.enum(["video", "text", "link"]),
              videoUrl: z.string().trim().max(500).optional(),
              bodyMd: z.string().max(20_000).optional(),
              externalUrl: z.string().trim().max(500).optional(),
            }),
          )
          .max(MAX_LESSONS_PER_MODULE),
      }),
    )
    .max(MAX_MODULES),
  reason: z.string().trim().min(1, "Reason is required."),
});

export async function PUT(req: Request) {
  const auth = await requireAdmin("products.edit");
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      "Course content input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { productId, modules, reason } = parsed.data;

  const variantIds = await getCourseVariantIdsForProduct(productId);
  if (variantIds.length === 0) {
    return err(
      "NOT_A_COURSE_PRODUCT",
      "Content can only be saved for a product with a variant listed as a course in courses.config.",
      400,
    );
  }

  // Kind discipline + video normalisation. The stored doc carries
  // ONLY the field its kind uses, and video URLs are stored as
  // canonical embed URLs on allowlisted hosts — anything else is a
  // 400 here, at save time, never a surprise at render time.
  const cleanedModules: CourseModule[] = [];
  for (const [mi, mod] of modules.entries()) {
    const seenIds = new Set<string>();
    const lessons: CourseModule["lessons"] = [];
    for (const lesson of mod.lessons) {
      if (seenIds.has(lesson.id)) {
        return err("VALIDATION_ERROR", "Duplicate lesson id in one module.", 400, [
          `modules.${mi}: lesson id ${lesson.id} appears twice`,
        ]);
      }
      seenIds.add(lesson.id);
      const base = { id: lesson.id, title: lesson.title, kind: lesson.kind };
      if (lesson.kind === "video") {
        if (!lesson.videoUrl) {
          return err("VALIDATION_ERROR", "A video lesson needs a video URL.", 400, [
            `modules.${mi}.lessons.${lesson.id}: videoUrl is required`,
          ]);
        }
        const embed = normalizeVideoEmbedUrl(lesson.videoUrl);
        if (embed === null) {
          return err(
            "INVALID_VIDEO_URL",
            "Video lessons accept YouTube or Vimeo URLs only.",
            400,
            [`modules.${mi}.lessons.${lesson.id}: ${lesson.videoUrl}`],
          );
        }
        lessons.push({ ...base, kind: "video", videoUrl: embed });
      } else if (lesson.kind === "text") {
        if (!lesson.bodyMd || lesson.bodyMd.trim() === "") {
          return err("VALIDATION_ERROR", "A text lesson needs body text.", 400, [
            `modules.${mi}.lessons.${lesson.id}: bodyMd is required`,
          ]);
        }
        lessons.push({ ...base, kind: "text", bodyMd: lesson.bodyMd });
      } else {
        if (!lesson.externalUrl || !/^https?:\/\//i.test(lesson.externalUrl)) {
          return err("VALIDATION_ERROR", "A link lesson needs an http/https URL.", 400, [
            `modules.${mi}.lessons.${lesson.id}: externalUrl must start with http:// or https://`,
          ]);
        }
        lessons.push({ ...base, kind: "link", externalUrl: lesson.externalUrl });
      }
    }
    cleanedModules.push({ title: mod.title, lessons });
  }

  const before = await loadCourseContent(productId);
  const doc: CourseContentDoc = { productId, modules: cleanedModules };
  try {
    await saveCourseContent(doc, auth.session.user.id);
  } catch {
    return err("DB_NOT_READY", "Course content could not be saved (database error).", 503);
  }
  const after = await loadCourseContent(productId);
  await writeAudit({
    actorId: auth.session.user.id,
    action: "courses.content.update",
    entityType: "Setting",
    entityId: courseContentKey(productId),
    beforeJson: before as unknown as Record<string, unknown> | null,
    afterJson: after as unknown as Record<string, unknown> | null,
    reason,
  });

  return NextResponse.json({
    data: { docKey: courseContentKey(productId), productId, doc: after },
    meta: { persistence: "setting-doc" },
  });
}
