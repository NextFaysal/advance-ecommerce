/**
 * Admin Themes API — /api/v1/admin/themes
 *
 * GET  → { data: AppTheme[] }   — requires settings.view
 * POST → { data: AppTheme }     — requires settings.edit
 *        Body: Omit<AppTheme, "id"|"createdAt"|"updatedAt">
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { getThemeCatalog, createTheme } from "@/lib/theme-repository";
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

export async function GET() {
  const auth = await requireAdmin(["settings.view"]);
  if ("error" in auth) return auth.error;

  try {
    const data = await getThemeCatalog();
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: [] });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(["settings.edit"]);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("INVALID_JSON", "Request body is not valid JSON.", 400);
  }

  if (typeof body !== "object" || body === null) {
    return err("VALIDATION_ERROR", "Body must be a JSON object.", 400);
  }

  const input = body as Partial<AppTheme>;
  if (!input.name || typeof input.name !== "string" || input.name.trim() === "") {
    return err("VALIDATION_ERROR", "Theme name is required.", 400);
  }
  if (!input.tokens || typeof input.tokens !== "object") {
    return err("VALIDATION_ERROR", "Theme tokens are required.", 400);
  }

  try {
    const theme = await createTheme({
      name: input.name.trim(),
      description: typeof input.description === "string" ? input.description : undefined,
      preview: Array.isArray(input.preview) ? (input.preview as string[]) : [],
      isActive: typeof input.isActive === "boolean" ? input.isActive : false,
      // Package linkage (doc 25 D1): a create may name the package the
      // instance belongs to (the admin gallery's starter-instance
      // action does). Absent → the repository lazily resolves the
      // instance to Aurora on read, exactly as before.
      packageId: typeof input.packageId === "string" ? input.packageId : undefined,
      tokens: input.tokens as AppTheme["tokens"],
    });
    return NextResponse.json({ data: theme }, { status: 201 });
  } catch (e) {
    return err(
      "THEME_CREATE_FAILED",
      e instanceof Error ? e.message : "Failed to create theme.",
      500,
    );
  }
}
