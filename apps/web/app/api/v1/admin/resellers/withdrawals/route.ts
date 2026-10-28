import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoResellerFlags, isResellerEnabled } from "@/reseller/flags";
import { reviewWithdrawalDb } from "@/reseller/store";

// Withdrawal review — Agent 14. RBAC: resellers.manage (dedicated
// money-out permission for withdrawal review actions).
// Status flow: PENDING -> APPROVED -> PAID, or PENDING|APPROVED -> REJECTED
// (releases the hold back to the reseller balance). The pure state machine
// is src/reseller/wallet.ts reviewWithdrawal; persistence is the Prisma
// store (src/reseller/store.ts). Review-to-PAID on a non-ACTIVE reseller
// is refused by the wallet guard with a status-specific reason (G1).
const reviewSchema = z.object({
  withdrawalId: z.string().min(1),
  action: z.enum(["APPROVED", "PAID", "REJECTED"]),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("resellers.manage");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isResellerEnabled(demoResellerFlags)) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Reseller module is locked for this install (module.reseller is OFF)." } },
      { status: 403 },
    );
  }
  const parsed = reviewSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid review input.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const result = await reviewWithdrawalDb(parsed.data.withdrawalId, {
      action: parsed.data.action,
      reviewedBy: guard.userId,
      note: parsed.data.note,
    });
    if (!result.ok) {
      if (result.notFound) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Withdrawal not found." } }, { status: 404 });
      }
      return NextResponse.json({ error: { code: "REVIEW_REJECTED", message: result.error } }, { status: 422 });
    }
    return NextResponse.json({
      data: { withdrawal: result.request },
      meta: { persistence: "database" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Reseller database is not available." } },
      { status: 503 },
    );
  }
}
