/**
 * Admin customers API — /api/v1/admin/customers
 * GET: list/filter. Phone is masked by default in every response
 * (phoneForViewer); a full phone is returned ONLY for a viewer with
 * customers.view_full_phone, and that view is audited via logPhoneAccess.
 * TEMPORARY MOCK: reads src/orders/mock.ts until Customer tables land
 * (Agent 6). Filters/pagination mirror the future Prisma query.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission, phoneForViewer, requirePermission, RbacError } from "@/lib/rbac";
import { logPhoneAccess } from "@/lib/audit";
import { MOCK_CUSTOMERS } from "@/orders/mock";
import type { Customer } from "@/orders/types";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

const listQuerySchema = z.object({
  search: z.string().optional(),
  tag: z.string().optional(),
  blocked: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: Request) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return err("UNAUTHENTICATED", "Admin login required.", 401);
  let session: Awaited<ReturnType<typeof validateSessionToken>> = null;
  try {
    session = await validateSessionToken(token);
  } catch {
    return err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503);
  }
  if (!session) return err("UNAUTHENTICATED", "Session expired or revoked.", 401);
  try {
    requirePermission(session.user.permissions, "customers.view");
  } catch (e) {
    if (e instanceof RbacError) return err("FORBIDDEN", e.message, 403);
    throw e;
  }

  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "List query invalid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const q = parsed.data;
  let rows: Customer[] = [...MOCK_CUSTOMERS];
  if (q.tag) rows = rows.filter((c) => c.tags.includes(q.tag as string));
  if (q.blocked !== undefined) rows = rows.filter((c) => c.blocked === (q.blocked === "true"));
  if (q.search) {
    const needle = q.search.toLowerCase();
    rows = rows.filter((c) => c.name.toLowerCase().includes(needle) || c.phone.includes(q.search as string));
  }
  const total = rows.length;
  const start = (q.page - 1) * q.pageSize;
  const canSeeFullPhone = hasPermission(session.user.permissions, "customers.view_full_phone");
  const pageRows = rows.slice(start, start + q.pageSize).map((c) => ({
    ...c,
    phone: phoneForViewer(c.phone, session.user.permissions) ?? "",
  }));
  if (canSeeFullPhone && pageRows.length > 0) {
    // A list view that exposes full phones must leave an audit trail per customer.
    for (const c of rows.slice(start, start + q.pageSize)) {
      await logPhoneAccess({
        actorId: session.user.id,
        customerId: c.id,
        reason: "Admin customer list view (full phone permission)",
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      });
    }
  }
  return NextResponse.json({
    data: pageRows,
    meta: { total, page: q.page, pageSize: q.pageSize, db: "NOT_WIRED", source: "TEMPORARY_MOCK", phonesMasked: !canSeeFullPhone },
  });
}
