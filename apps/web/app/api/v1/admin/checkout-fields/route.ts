/**
 * Admin checkout-fields config API — /api/v1/admin/checkout-fields
 * (doc 28).
 *
 *   GET -> the coerced checkout.fields document (defaults when the
 *          merchant has never saved one). Requires settings.view.
 *   PUT { config, reason }
 *       -> whole-document replace. Requires settings.edit and a
 *          non-empty `reason`; the submitted config is coerced by
 *          coerceCheckoutFieldsConfig (locked flags forced, unknown
 *          keys dropped, lengths clamped) and audited
 *          (checkout.fields.update) with before/after documents.
 *
 * Storage is the Setting-document store in src/checkout/
 * fields-server.ts — NOT the generic settings POST: setSetting()
 * rejects keys outside SETTING_DEFAULTS, the same reason
 * restaurant.config and templates.* docs have their own stores.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { coerceCheckoutFieldsConfig } from "@/checkout/fields";
import {
  CHECKOUT_FIELDS_KEY,
  getCheckoutFieldsConfig,
  saveCheckoutFieldsConfig,
} from "@/checkout/fields-server";

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

  const config = await getCheckoutFieldsConfig();
  return NextResponse.json({ data: config });
}

const putSchema = z.object({
  config: z.record(z.string(), z.unknown()),
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
      "Checkout fields config input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { reason } = parsed.data;
  const config = coerceCheckoutFieldsConfig(parsed.data.config);

  const before = await getCheckoutFieldsConfig();
  try {
    await saveCheckoutFieldsConfig(config, auth.session.user.id);
  } catch {
    return err("DB_NOT_READY", "Checkout fields config could not be saved (database error).", 503);
  }
  const after = await getCheckoutFieldsConfig();
  await writeAudit({
    actorId: auth.session.user.id,
    action: "checkout.fields.update",
    entityType: "Setting",
    entityId: CHECKOUT_FIELDS_KEY,
    beforeJson: before,
    afterJson: after,
    reason,
  });

  return NextResponse.json({ data: after });
}
