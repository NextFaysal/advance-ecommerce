import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoResellerFlags, isResellerEnabled } from "@/reseller/flags";
import { decidePayoutRequestDb, listPayoutRequestsAdmin } from "@/reseller/payout-store";
import { recordDemoAudit } from "../../audit-log/store";

// Reseller payout requests — admin side (ADV-12).
// GET:  list every request (resellers.view), with the owning reseller's
//       name + MASKED phone and each reseller's computed balances.
// POST: decide one request (resellers.manage) — APPROVED / PAID /
//       REJECTED through the pure state machine in src/reseller/payouts.ts.
//       PAID means "staff recorded an external payment" — this route
//       never moves money itself. Every decision is audit-logged.
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
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("resellers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isResellerEnabled(demoResellerFlags)) return locked();
  try {
    const requests = await listPayoutRequestsAdmin();
    return NextResponse.json({
      data: { requests },
      meta: {
        persistence: "database",
        module: "module.reseller",
        note: "PAID = staff recorded an external payment; no money moves automatically.",
      },
    });
  } catch {
    return dbNotReady();
  }
}

const decideSchema = z.object({
  payoutId: z.string().min(1),
  action: z.enum(["APPROVED", "PAID", "REJECTED"]),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("resellers.manage");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isResellerEnabled(demoResellerFlags)) return locked();
  const parsed = decideSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "payoutId + valid action required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const result = await decidePayoutRequestDb(parsed.data.payoutId, {
      action: parsed.data.action,
      decidedById: guard.userId,
    });
    if (!result.ok) {
      if (result.notFound) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Payout request not found." } }, { status: 404 });
      }
      return NextResponse.json({ error: { code: "DECISION_REJECTED", message: result.error } }, { status: 422 });
    }
    await recordDemoAudit({
      actorId: guard.userId,
      action: "resellers.payout.decide",
      entityType: "ResellerPayoutRequest",
      entityId: result.request.id,
      afterJson: {
        resellerId: result.request.resellerId,
        amountPoisha: result.request.amountPoisha,
        method: result.request.method,
        status: result.request.status,
      },
      reason:
        parsed.data.note ??
        (result.request.status === "PAID"
          ? "Marked PAID — staff recorded an external payment to the reseller."
          : `Payout request ${result.request.status.toLowerCase()} from the admin panel.`),
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ data: { request: result.request }, meta: { persistence: "database" } });
  } catch {
    return dbNotReady();
  }
}
