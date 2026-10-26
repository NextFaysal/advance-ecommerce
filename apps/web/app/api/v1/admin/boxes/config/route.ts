/**
 * Admin subscription-boxes config API — /api/v1/admin/boxes/config
 * (ADV-23 vertical 4, doc 23 wave 56).
 *
 *   GET -> the stored boxes.config document + its source
 *          ("saved" | "default") + both module flags' state.
 *          Requires settings.view.
 *   PUT { boxVariantIds, cycles, discountBps, reason }
 *       -> whole-document replace. Requires settings.edit and a
 *          non-empty `reason`; validated by the config zod schema
 *          and audited (boxes.config.update) with before/after
 *          documents.
 *
 * Storage is the Setting-document store in src/boxes/config.ts —
 * NOT the generic settings POST: setSetting() rejects keys outside
 * SETTING_DEFAULTS, the same reason services.config and
 * restaurant.config have their own stores. This route intentionally
 * does NOT require either module flag (the sibling config
 * precedent): a merchant prepares the config first, then enables
 * the paid modules.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  BOXES_CONFIG_KEY,
  boxesConfigObjectSchema,
  loadBoxesConfig,
  saveBoxesConfig,
} from "@/boxes/config";
import { SUBSCRIPTION_BOXES_FLAG, subscriptionBoxesEnabled } from "@/boxes/flags";
import { SUBSCRIPTIONS_FLAG_KEY, subscriptionsEnabled } from "@/subscriptions/flags";

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

  const loaded = await loadBoxesConfig();
  return NextResponse.json({
    data: {
      docKey: BOXES_CONFIG_KEY,
      flag: SUBSCRIPTION_BOXES_FLAG,
      moduleEnabled: subscriptionBoxesEnabled(),
      engineFlag: SUBSCRIPTIONS_FLAG_KEY,
      engineEnabled: subscriptionsEnabled(),
      config: loaded.config,
      source: loaded.source,
      effective: loaded.effective,
    },
    meta: { persistence: "setting-doc" },
  });
}

const putSchema = boxesConfigObjectSchema.extend({
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
      "Boxes config input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { reason, ...config } = parsed.data;

  const before = await loadBoxesConfig();
  try {
    await saveBoxesConfig(config, auth.session.user.id);
  } catch {
    return err("DB_NOT_READY", "Boxes config could not be saved (database error).", 503);
  }
  const after = await loadBoxesConfig();
  await writeAudit({
    actorId: auth.session.user.id,
    action: "boxes.config.update",
    entityType: "Setting",
    entityId: BOXES_CONFIG_KEY,
    beforeJson: before.config,
    afterJson: after.config,
    reason,
  });

  return NextResponse.json({
    data: {
      docKey: BOXES_CONFIG_KEY,
      config: after.config,
      source: after.source,
      effective: after.effective,
    },
    meta: { persistence: "setting-doc" },
  });
}
