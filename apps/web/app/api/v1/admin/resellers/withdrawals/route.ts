import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoResellerFlags, isResellerEnabled } from "@/reseller/flags";
import { demoWalletEntries, demoWithdrawals, findDemoReseller } from "@/reseller/service";
import { reviewWithdrawal } from "@/reseller/wallet";

// Withdrawal review — Agent 14. RBAC: resellers.manage (dedicated
// money-out permission for withdrawal review actions).
// Status flow: PENDING -> APPROVED -> PAID, or PENDING|APPROVED -> REJECTED
// (releases the hold back to the reseller balance). See src/reseller/wallet.ts.
const reviewSchema = z.object({
  withdrawalId: z.string().min(1),
  action: z.enum(["APPROVED", "PAID", "REJECTED"]),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
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
  const idx = demoWithdrawals.findIndex((w) => w.id === parsed.data.withdrawalId);
  const existing = demoWithdrawals[idx];
  if (idx === -1 || !existing) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Withdrawal not found." } }, { status: 404 });
  }
  const result = reviewWithdrawal(
    demoWalletEntries.filter((e) => e.resellerId === existing.resellerId),
    existing,
    {
      action: parsed.data.action,
      reseller: findDemoReseller(existing.resellerId),
      reviewedBy: guard.userId,
      reviewedAt: new Date().toISOString(),
      note: parsed.data.note,
      releaseEntryId: `wlt-${Date.now()}-release`,
    },
  );
  if (!result.ok) {
    return NextResponse.json({ error: { code: "REVIEW_REJECTED", message: result.error } }, { status: 422 });
  }
  demoWithdrawals[idx] = result.request;
  if (result.releaseEntry) demoWalletEntries.push(result.releaseEntry);
  return NextResponse.json({
    data: { withdrawal: result.request },
    meta: { persistence: "in-memory-demo" },
  });
}
