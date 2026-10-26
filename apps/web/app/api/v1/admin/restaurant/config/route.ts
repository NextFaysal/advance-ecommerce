/**
 * Admin restaurant config API — /api/v1/admin/restaurant/config
 * (ADV-23 vertical 1, doc 23 wave 56).
 *
 *   GET -> the stored restaurant.config document + its source
 *          ("saved" | "default") + the EFFECTIVE config consumers
 *          honour (dine-in is already false there when no tables
 *          are configured — the API shows both so the distinction
 *          is never hidden). Requires settings.view.
 *   PUT { tables, takeawayEnabled, dineInEnabled, reason }
 *       -> whole-document replace. Requires settings.edit and a
 *          non-empty `reason`; validated by the config zod schema
 *          (tables: trimmed non-empty labels, cap 50) and audited
 *          (restaurant.config.update) with before/after documents.
 *
 * Storage is the Setting-document store in src/restaurant/
 * config.ts — NOT the generic settings POST: setSetting() rejects
 * keys outside SETTING_DEFAULTS, the same reason templates.* and
 * custom_fields.* docs have their own stores.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  RESTAURANT_CONFIG_KEY,
  loadRestaurantConfig,
  restaurantConfigSchema,
  saveRestaurantConfig,
} from "@/restaurant/config";
import { isRestaurantEnabled, RESTAURANT_FLAG } from "@/restaurant/flags";

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

  const loaded = await loadRestaurantConfig();
  return NextResponse.json({
    data: {
      docKey: RESTAURANT_CONFIG_KEY,
      flag: RESTAURANT_FLAG,
      moduleEnabled: isRestaurantEnabled(),
      config: loaded.config,
      source: loaded.source,
      effective: loaded.effective,
    },
    meta: { persistence: "setting-doc" },
  });
}

const putSchema = restaurantConfigSchema.extend({
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
      "Restaurant config input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { reason, ...config } = parsed.data;

  const before = await loadRestaurantConfig();
  try {
    await saveRestaurantConfig(config, auth.session.user.id);
  } catch {
    return err("DB_NOT_READY", "Restaurant config could not be saved (database error).", 503);
  }
  const after = await loadRestaurantConfig();
  await writeAudit({
    actorId: auth.session.user.id,
    action: "restaurant.config.update",
    entityType: "Setting",
    entityId: RESTAURANT_CONFIG_KEY,
    beforeJson: before.config,
    afterJson: after.config,
    reason,
  });

  return NextResponse.json({
    data: {
      docKey: RESTAURANT_CONFIG_KEY,
      config: after.config,
      source: after.source,
      effective: after.effective,
    },
    meta: { persistence: "setting-doc" },
  });
}
