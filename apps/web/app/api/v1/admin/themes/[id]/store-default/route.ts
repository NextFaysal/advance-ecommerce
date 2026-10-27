/**
 * Admin Theme store-default API — /api/v1/admin/themes/[id]/store-default
 *
 * POST   → make this theme THE store default (exclusive) — settings.edit
 *          Body: { reason } (required). The store default is what
 *          visitors who never picked a theme see; it is distinct from
 *          isActive, which only publishes a theme to the customer
 *          picker. Audited as themes.store_default.apply.
 * DELETE → clear this theme's store-default flag — settings.edit
 *          Body: { reason } (required). Audited as
 *          themes.store_default.clear. 409 when this theme is not
 *          the current store default.
 */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  getStoreDefaultTheme,
  setStoreDefaultTheme,
} from "@/lib/theme-repository";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permissions: PermissionKey[]) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    for (const permission of permissions) requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Database not ready.", 503) };
  }
}

interface RouteParams {
  params: { id: string };
}

/**
 * Theme activation freshness (S3a): the store theme is resolved
 * server-side from store-global data, so ISR pages would otherwise
 * pick a switch up only at their next revalidation. Revalidating the
 * root layout makes the new store theme apply on the very next
 * request. Best-effort: a revalidation failure must never fail the
 * activation itself (the ISR windows remain the backstop).
 */
function revalidateStorefront(): void {
  try {
    revalidatePath("/", "layout");
  } catch {
    // Ignore — activation already persisted + audited.
  }
}

/** Parse + validate the mandatory audit reason from the JSON body. */
async function readReason(req: Request): Promise<{ reason: string } | { error: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: err("INVALID_JSON", "Request body is not valid JSON.", 400) };
  }
  const reason =
    typeof body === "object" && body !== null
      ? (body as { reason?: unknown }).reason
      : undefined;
  if (typeof reason !== "string" || reason.trim() === "") {
    return {
      error: err("VALIDATION_ERROR", "A reason is required for this action.", 400),
    };
  }
  return { reason: reason.trim() };
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(["settings.edit"]);
  if ("error" in auth) return auth.error;

  const { id } = params;
  if (!id) return err("MISSING_ID", "Theme id is required.", 400);

  const parsed = await readReason(req);
  if ("error" in parsed) return parsed.error;

  try {
    const { previous, next } = await setStoreDefaultTheme(id);
    await writeAudit({
      actorId: auth.session.user.id,
      action: "themes.store_default.apply",
      entityType: "AppTheme",
      entityId: id,
      beforeJson: {
        storeDefaultThemeId: previous?.id ?? null,
        storeDefaultThemeName: previous?.name ?? null,
      },
      afterJson: {
        storeDefaultThemeId: next?.id ?? null,
        storeDefaultThemeName: next?.name ?? null,
      },
      reason: parsed.reason,
    });
    revalidateStorefront();
    return NextResponse.json({ data: next });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to set the store default theme.";
    if (message.includes("not found")) return err("NOT_FOUND", message, 404);
    return err("THEME_STORE_DEFAULT_FAILED", message, 500);
  }
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(["settings.edit"]);
  if ("error" in auth) return auth.error;

  const { id } = params;
  if (!id) return err("MISSING_ID", "Theme id is required.", 400);

  const parsed = await readReason(req);
  if ("error" in parsed) return parsed.error;

  try {
    const current = await getStoreDefaultTheme();
    if (!current || current.id !== id) {
      return err("NOT_STORE_DEFAULT", "This theme is not the current store default.", 409);
    }
    await setStoreDefaultTheme(null);
    await writeAudit({
      actorId: auth.session.user.id,
      action: "themes.store_default.clear",
      entityType: "AppTheme",
      entityId: id,
      beforeJson: {
        storeDefaultThemeId: current.id,
        storeDefaultThemeName: current.name,
      },
      afterJson: { storeDefaultThemeId: null, storeDefaultThemeName: null },
      reason: parsed.reason,
    });
    revalidateStorefront();
    return NextResponse.json({ data: { id, storeDefault: false } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to clear the store default theme.";
    return err("THEME_STORE_DEFAULT_FAILED", message, 500);
  }
}
