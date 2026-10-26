/**
 * Admin Theme detail API — /api/v1/admin/themes/[id]
 *
 * PATCH  → { data: AppTheme }  — requires settings.edit
 *           Body: partial AppTheme fields (name, tokens, isActive, …)
 * DELETE → { data: { id } }   — requires settings.edit
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { updateTheme, deleteTheme } from "@/lib/theme-repository";
import type { AppTheme } from "@/lib/themes";

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

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(["settings.edit"]);
  if ("error" in auth) return auth.error;

  const { id } = params;
  if (!id) return err("MISSING_ID", "Theme id is required.", 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("INVALID_JSON", "Request body is not valid JSON.", 400);
  }

  if (typeof body !== "object" || body === null) {
    return err("VALIDATION_ERROR", "Body must be a JSON object.", 400);
  }

  try {
    const input = body as Partial<Omit<AppTheme, "id" | "createdAt">>;
    const updated = await updateTheme(id, input);
    return NextResponse.json({ data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update theme.";
    if (message.includes("not found")) return err("NOT_FOUND", message, 404);
    return err("THEME_UPDATE_FAILED", message, 500);
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(["settings.edit"]);
  if ("error" in auth) return auth.error;

  const { id } = params;
  if (!id) return err("MISSING_ID", "Theme id is required.", 400);

  try {
    await deleteTheme(id);
    return NextResponse.json({ data: { id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to delete theme.";
    return err("THEME_DELETE_FAILED", message, 500);
  }
}
