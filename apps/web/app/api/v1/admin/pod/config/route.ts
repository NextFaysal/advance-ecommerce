/**
 * Admin print-on-demand config API — /api/v1/admin/pod/config
 * (ADV-23 vertical 5, doc 23 wave 56).
 *
 *   GET -> the stored pod.config document + its source
 *          ("saved" | "default"). Requires settings.view.
 *   PUT { podVariantIds, printFeePoisha, textMaxChars,
 *         allowImageUpload, colors, reason }
 *       -> whole-document replace. Requires settings.edit and a
 *          non-empty `reason`; validated by the config zod schema
 *          and audited (pod.config.update) with before/after
 *          documents.
 *
 * Storage is the Setting-document store in src/pod/config.ts —
 * NOT the generic settings POST: setSetting() rejects keys
 * outside SETTING_DEFAULTS, the same reason rental.config and
 * services.config docs have their own stores. This route
 * intentionally does NOT require the module.print_on_demand flag
 * (the rental/services config precedent): a merchant prepares the
 * config first, then enables the paid module.
 *
 * Note what the config cannot do in v1: `allowImageUpload` is
 * stored intent only — customer artwork upload needs object
 * storage (Settings storage.*), which is unconfigured until the
 * merchant adds R2/S3 credentials, so no upload endpoint exists
 * and no surface offers one. Changing the fee / cap / palette
 * never rewrites placed orders: each order froze its
 * customisation + fee onto its create-time note.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  POD_CONFIG_KEY,
  loadPodConfig,
  savePodConfig,
  podConfigObjectSchema,
  podConfigSchema,
} from "@/pod/config";
import { isPodEnabled, POD_FLAG } from "@/pod/flags";

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

  const loaded = await loadPodConfig();
  return NextResponse.json({
    data: {
      docKey: POD_CONFIG_KEY,
      flag: POD_FLAG,
      moduleEnabled: isPodEnabled(),
      config: loaded.config,
      source: loaded.source,
      effective: loaded.effective,
    },
    meta: { persistence: "setting-doc" },
  });
}

// The plain object schema carries the fields; the full schema
// parse of the config half runs below (kept identical in shape to
// the rental config route).
const putSchema = podConfigObjectSchema.extend({
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
      "Print-on-demand config input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { reason, ...config } = parsed.data;
  const refined = podConfigSchema.safeParse(config);
  if (!refined.success) {
    return err(
      "VALIDATION_ERROR",
      "Print-on-demand config input invalid.",
      400,
      refined.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }

  const before = await loadPodConfig();
  try {
    await savePodConfig(config, auth.session.user.id);
  } catch {
    return err("DB_NOT_READY", "Print-on-demand config could not be saved (database error).", 503);
  }
  const after = await loadPodConfig();
  await writeAudit({
    actorId: auth.session.user.id,
    action: "pod.config.update",
    entityType: "Setting",
    entityId: POD_CONFIG_KEY,
    beforeJson: before.config,
    afterJson: after.config,
    reason,
  });

  return NextResponse.json({
    data: {
      docKey: POD_CONFIG_KEY,
      config: after.config,
      source: after.source,
      effective: after.effective,
    },
    meta: { persistence: "setting-doc" },
  });
}
