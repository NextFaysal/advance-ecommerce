import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { BD_PHONE_REGEX, maskPhone, normalizeBdPhone } from "@/checkout/validation";
import { demoResellerFlags, isResellerEnabled } from "@/reseller/flags";
import { buildDashboardsDb, createReseller, listWithdrawals, requestWithdrawalDb } from "@/reseller/store";
import { withdrawalRequestSchema, type Reseller } from "@/reseller/types";
import { recordDemoAudit } from "../audit-log/store";

// Resellers — Agent 14, Step 46 (A5). RBAC: resellers.view (list) /
// resellers.manage (writes). The shared guard accepts one permission,
// so reports.view is not kept as a legacy alias.
// Feature flag: module.reseller (defaults OFF -> 403 FEATURE_LOCKED).
// Persistence: Prisma DB via src/reseller/store.ts (the pure wallet
// rules in src/reseller/wallet.ts still decide every money action,
// including the G1 status guards).
// POST carries TWO writes on this one path (wave 7 added the first):
//   - a body WITHOUT `resellerId` creates a RESELLER (name + BD phone);
//     the store generates the ?ref= attribution code and the row starts
//     PENDING_APPROVAL. Guarded by resellers.manage — the dedicated
//     reseller write permission the seed defines and the withdrawal
//     actions below already use; creation is audit-logged
//     (resellers.create), mirroring staff.invite.
//   - a body WITH `resellerId` is the original withdrawal request.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Reseller module is locked for this install (module.reseller is OFF)." } },
    { status: 403 },
  );
}

function dbNotReady() {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Reseller database is not available." } },
    { status: 503 },
  );
}

export async function GET() {
  const guard = await requireAdmin("resellers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isResellerEnabled(demoResellerFlags)) return locked();
  try {
    const [dashboards, withdrawals] = await Promise.all([buildDashboardsDb(), listWithdrawals()]);
    return NextResponse.json({
      data: { dashboards, withdrawals },
      meta: { persistence: "database", module: "module.reseller" },
    });
  } catch {
    return dbNotReady();
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002";
}

/** Create payload: name + BD phone (normalized to +8801XXXXXXXXX, the
 * same refine/transform pair checkout uses). Tier is NOT accepted —
 * createReseller stores BRONZE as the starting tier and the ADV-12
 * engine derives the effective tier from lifetime earned commission. */
const createResellerSchema = z.object({
  name: z.string().trim().min(2, "নাম দিতে হবে").max(80),
  phone: z
    .string()
    .refine((v) => BD_PHONE_REGEX.test(v.replace(/[\s-]/g, "")), {
      message: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (01XXXXXXXXX)",
    })
    .transform((v) => normalizeBdPhone(v) as string),
});

/** POST branch: create a reseller. The response carries the MASKED
 * phone (the dashboards' privacy rule — full numbers never travel in
 * list/response payloads) plus the generated attribution code. */
async function createResellerPost(
  body: Record<string, unknown>,
  guard: { userId: string },
  req: Request,
) {
  const parsed = createResellerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "name + valid BD phone required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  let reseller: Reseller;
  try {
    reseller = await createReseller({ name: parsed.data.name, phone: parsed.data.phone });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json(
        { error: { code: "DUPLICATE_PHONE", message: "A reseller with this phone number already exists." } },
        { status: 409 },
      );
    }
    return dbNotReady();
  }
  // Identity creation is audit-logged like staff.invite; the audit
  // write is awaited unguarded (the staff convention) so a failed
  // audit surfaces instead of silently losing the record.
  await recordDemoAudit({
    actorId: guard.userId,
    action: "resellers.create",
    entityType: "Reseller",
    entityId: reseller.id,
    afterJson: {
      name: reseller.name,
      phoneMasked: maskPhone(reseller.phone),
      status: reseller.status,
      tier: reseller.tier,
      code: reseller.code ?? null,
    },
    reason: "Reseller created from the admin panel (starts PENDING_APPROVAL).",
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json(
    {
      data: {
        reseller: {
          id: reseller.id,
          name: reseller.name,
          phoneMasked: maskPhone(reseller.phone),
          status: reseller.status,
          tier: reseller.tier,
          code: reseller.code ?? null,
          createdAt: reseller.createdAt,
        },
        note: "New resellers start as PENDING_APPROVAL. Their ?ref= share link attributes orders only once the reseller is ACTIVE.",
      },
      meta: { persistence: "database" },
    },
    { status: 201 },
  );
}

export async function POST(req: Request) {
  const guard = await requireAdmin("resellers.manage");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isResellerEnabled(demoResellerFlags)) return locked();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // No resellerId -> reseller CREATE (see header). A body WITH one is
  // the withdrawal request below, unchanged.
  const resellerId = typeof body.resellerId === "string" ? body.resellerId : null;
  if (resellerId === null) {
    return createResellerPost(body, guard, req);
  }
  const parsed = withdrawalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "resellerId + valid withdrawal fields required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const result = await requestWithdrawalDb({
      resellerId,
      amountPoisha: parsed.data.amountPoisha,
      method: parsed.data.method,
      accountRefMasked: parsed.data.accountRefMasked,
    });
    if (!result.ok) {
      return NextResponse.json({ error: { code: "WITHDRAWAL_REJECTED", message: result.error } }, { status: 422 });
    }
    return NextResponse.json(
      { data: { withdrawal: result.request }, meta: { persistence: "database" } },
      { status: 201 },
    );
  } catch {
    return dbNotReady();
  }
}
