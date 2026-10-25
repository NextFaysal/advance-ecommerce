/**
 * Admin order refunds — /api/v1/admin/orders/[id]/refunds (doc 17, O0)
 * GET:  refund history + money summary for the order (payments.view).
 * POST: record a refund in PENDING (payments.refund) — the workbench in
 *       src/orders/refunds.ts owns the lifecycle and the over-refund
 *       cap; this route only authenticates, validates and maps errors.
 *
 * The system RECORDS refunds staff send via bKash/bank themselves; it
 * never moves money. Status moves live on the [refundId] route.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import {
  createRefund,
  listRefunds,
  REFUND_METHODS,
  type RefundResult,
} from "@/orders/refunds";

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
  ORDER_NOT_FOUND: 404,
  REFUND_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  REASON_REQUIRED: 400,
  REFERENCE_REQUIRED: 400,
  OVER_REFUND: 409,
  INVALID_TRANSITION: 409,
};

function unwrap<T>(result: RefundResult<T>): { value: T } | { response: NextResponse } {
  if (result.ok) return { value: result.value };
  return { response: err(result.code, result.error, ERROR_HTTP[result.code] ?? 400) };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("payments.view");
  if ("error" in auth) return auth.error;
  const out = unwrap(await listRefunds(params.id));
  if ("response" in out) return out.response;
  return NextResponse.json({
    data: out.value,
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}

const createSchema = z.object({
  /** Amount in TAKA as entered in the panel; converted to poisha here. */
  amountTaka: z.number().positive().optional(),
  /** Exact amount in poisha (API callers); wins over amountTaka. */
  amountPoisha: z.number().int().positive().optional(),
  method: z.enum(REFUND_METHODS),
  reference: z.string().trim().max(120).optional().nullable(),
  reason: z.string().trim().min(1),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("payments.refund");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success || (parsed.data.amountPoisha === undefined && parsed.data.amountTaka === undefined)) {
    return err(
      "INVALID_INPUT",
      "amountTaka (or amountPoisha), method and a reason are required. / পরিমাণ, মাধ্যম ও কারণ আবশ্যক।",
      400,
    );
  }
  const amountPoisha =
    parsed.data.amountPoisha ?? Math.round((parsed.data.amountTaka as number) * 100);
  const out = unwrap(
    await createRefund(
      params.id,
      {
        amountPoisha,
        method: parsed.data.method,
        reference: parsed.data.reference ?? null,
        reason: parsed.data.reason,
      },
      auth.session.user.id,
    ),
  );
  if ("response" in out) return out.response;
  return NextResponse.json(
    { data: out.value, meta: { db: "PRISMA", source: "DATABASE" } },
    { status: 201 },
  );
}
