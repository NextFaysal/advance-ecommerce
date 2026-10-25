/**
 * Admin exchange execution — POST /api/v1/admin/returns/[id]/exchange
 * (doc 17 batch O7, part 2). Guard: returns.manage (the RMA pair
 * O7-1 added to rbac — the same permission family as the admin
 * returns routes).
 *
 * Body: { items: [{ variantId, quantity }] } — the replacement lines,
 * priced at CURRENT catalog by the service. src/orders/exchange.ts
 * owns the whole money rule (credit Payment on the replacement,
 * excess → PENDING refund on the original, double-exchange guard);
 * this route only authenticates, validates, maps errors, and fires
 * the customer notification (notifyReturnStatus "EXCHANGED" — the
 * SMS is QUEUED, not delivered; the response meta says so honestly).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { executeExchange, type ExchangeResult } from "@/orders/exchange";
import { notifyReturnStatus } from "@/orders/return-notify";

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

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

const ERROR_HTTP: Record<string, number> = {
  RETURN_NOT_FOUND: 404,
  RETURN_NOT_EXCHANGEABLE: 409,
  ALREADY_EXCHANGED: 409,
  RETURN_LINES_UNREADABLE: 409,
  VARIANT_NOT_FOUND: 400,
  CREATE_FAILED: 422,
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("returns.manage");
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "INVALID_INPUT",
      "items (variantId + quantity) are required. / বদলি পণ্যের তালিকা আবশ্যক।",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }

  const { ip, userAgent } = {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
  const result: ExchangeResult = await executeExchange(params.id, parsed.data.items, {
    id: auth.session.user.id,
    permissions: auth.session.user.permissions,
    ip,
    userAgent,
  });
  if (!result.ok) {
    return err(result.code, result.error, ERROR_HTTP[result.code] ?? 400);
  }

  // Customer notification (queued SMS — see return-notify.ts header;
  // the account returns list is the always-visible status surface).
  const notify = await notifyReturnStatus(params.id, "EXCHANGED");

  return NextResponse.json(
    {
      data: {
        returnId: result.returnId,
        originalOrderId: result.originalOrderId,
        originalOrderNo: result.originalOrderNo,
        replacementOrderId: result.replacementOrderId,
        replacementOrderNo: result.replacementOrderNo,
        returnedGoodsPoisha: result.returnedGoodsPoisha,
        replacementGoodsPoisha: result.replacementGoodsPoisha,
        differencePoisha: result.differencePoisha,
        creditAppliedPoisha: result.creditAppliedPoisha,
        payablePoisha: result.payablePoisha,
        refundId: result.refundId,
        refundError: result.refundError,
      },
      meta: { db: "PRISMA", source: "DATABASE", sms: notify.sms },
    },
    { status: 201 },
  );
}
