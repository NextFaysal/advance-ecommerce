/**
 * Admin COD remittances — /api/v1/admin/remittances (doc 17, O8)
 * GET: batch list (payments.view) — meta also carries the outstanding
 * summary (collections recorded but in no batch yet, grouped by
 * provider with aging, plus the unattributed count) so the admin page
 * renders in one fetch.
 * POST: create a batch for (provider, period) from recorded COD
 * collections not already in a batch (payments.remit; audited in the
 * service). Expected is always Σ the covered Payment rows.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import {
  createRemittanceBatch,
  getOutstandingRemittances,
  listRemittanceBatches,
  type RemittanceResult,
} from "@/orders/remittance";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: PermissionKey) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503) };
  }
}

const ERROR_HTTP: Record<string, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  NO_COLLECTIONS: 422,
  NOTE_REQUIRED: 422,
};

function unwrap<T>(result: RemittanceResult<T>): { value: T } | { response: NextResponse } {
  if (result.ok) return { value: result.value };
  return { response: err(result.code, result.error, ERROR_HTTP[result.code] ?? 400) };
}

export async function GET(req: Request) {
  const auth = await requireAdmin("payments.view");
  if ("error" in auth) return auth.error;
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
  const out = unwrap(
    await listRemittanceBatches({
      status: url.searchParams.get("status") ?? undefined,
      provider: url.searchParams.get("provider") ?? undefined,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 25,
    }),
  );
  if ("response" in out) return out.response;
  const outstanding = unwrap(await getOutstandingRemittances());
  return NextResponse.json({
    data: out.value.batches,
    meta: {
      db: "PRISMA",
      source: "DATABASE",
      total: out.value.total,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 25,
      outstanding: "value" in outstanding ? outstanding.value : null,
    },
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin("payments.remit");
  if ("error" in auth) return auth.error;
  let body: { provider?: unknown; periodStart?: unknown; periodEnd?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("INVALID_INPUT", "JSON body required.", 400);
  }
  if (typeof body.provider !== "string" || typeof body.periodStart !== "string" || typeof body.periodEnd !== "string") {
    return err("INVALID_INPUT", "provider, periodStart and periodEnd (ISO strings) are required.", 400);
  }
  const out = unwrap(
    await createRemittanceBatch(
      {
        provider: body.provider,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
      },
      { id: auth.session.user.id },
    ),
  );
  if ("response" in out) return out.response;
  return NextResponse.json({ data: out.value }, { status: 201 });
}
