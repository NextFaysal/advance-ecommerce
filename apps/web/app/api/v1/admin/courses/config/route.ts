/**
 * Admin courses config API — /api/v1/admin/courses/config
 * (ADV-23 vertical 6, doc 23 wave 56).
 *
 *   GET -> the stored courses.config document + its source
 *          ("saved" | "default") + the module flag state.
 *          Requires settings.view.
 *   PUT { courseVariantIds, reason }
 *       -> whole-document replace. Requires settings.edit and a
 *          non-empty `reason`; validated by the config zod schema
 *          and audited (courses.config.update) with before/after
 *          documents.
 *
 * Storage is the Setting-document store in src/courses/config.ts —
 * NOT the generic settings POST: setSetting() rejects keys outside
 * SETTING_DEFAULTS, the same reason boxes.config / pod.config have
 * their own stores. This route intentionally does NOT require the
 * module.courses flag (the sibling config precedent): a merchant
 * prepares the config first, then enables the paid module.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  COURSES_CONFIG_KEY,
  coursesConfigObjectSchema,
  loadCoursesConfig,
  saveCoursesConfig,
} from "@/courses/config";
import { COURSES_FLAG, coursesEnabled } from "@/courses/flags";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: "settings.view" | "settings.edit") {
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

export async function GET() {
  const auth = await requireAdmin("settings.view");
  if ("error" in auth) return auth.error;

  const loaded = await loadCoursesConfig();
  return NextResponse.json({
    data: {
      docKey: COURSES_CONFIG_KEY,
      flag: COURSES_FLAG,
      moduleEnabled: coursesEnabled(),
      config: loaded.config,
      source: loaded.source,
      effective: loaded.effective,
    },
    meta: { persistence: "setting-doc" },
  });
}

const putSchema = coursesConfigObjectSchema.extend({
  reason: z.string().trim().min(1, "Reason is required."),
});

export async function PUT(req: Request) {
  const auth = await requireAdmin("settings.edit");
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      "Courses config input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { reason, ...config } = parsed.data;

  const before = await loadCoursesConfig();
  try {
    await saveCoursesConfig(config, auth.session.user.id);
  } catch {
    return err("DB_NOT_READY", "Courses config could not be saved (database error).", 503);
  }
  const after = await loadCoursesConfig();
  await writeAudit({
    actorId: auth.session.user.id,
    action: "courses.config.update",
    entityType: "Setting",
    entityId: COURSES_CONFIG_KEY,
    beforeJson: before.config,
    afterJson: after.config,
    reason,
  });

  return NextResponse.json({
    data: {
      docKey: COURSES_CONFIG_KEY,
      config: after.config,
      source: after.source,
      effective: after.effective,
    },
    meta: { persistence: "setting-doc" },
  });
}
