import { NextResponse } from "next/server";
import { parseMerchantSmsInputSchema } from "@/bd/sms-autoverify";
import { autoVerifySmsDb } from "@/bd/sms-trx-registry-db";
import { guardError, requireAdmin } from "@/reports/guard";

// POST /api/v1/admin/bd/sms-verify — Agent 11, Step 44 (E1).
// RBAC: payments.verify_manual.
// Persistence: DB-backed since doc 21 G3-8 (W0-D) — verified TrxID
// claims live in the SmsTrxClaim table with UNIQUE(method, trxId)
// (src/bd/sms-trx-registry-db.ts), so a (provider, TrxID) pair can be
// verified exactly once across restarts and processes. This route
// previously used the in-memory demoTrxRegistry and reported
// meta.persistence "in-memory-demo".
// The raw SMS body is never stored or logged by this route — only the
// parsed fields (with the sender phone masked) leave this handler.
export async function POST(req: Request) {
  const guard = await requireAdmin("payments.verify_manual");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = parseMerchantSmsInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid SMS verify request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const { smsText, providerHint, orderId, expectedAmountPoisha, customerPhone } = parsed.data;
  const { parse, match } = await autoVerifySmsDb(
    smsText,
    { orderId, amountPoisha: expectedAmountPoisha, customerPhone: customerPhone ?? null },
    providerHint,
  );
  if (!parse.ok) {
    return NextResponse.json({
      data: { verified: false, parseReason: parse.reason },
      meta: { persistence: "database" },
    });
  }
  return NextResponse.json({
    data: {
      verified: match?.matched ?? false,
      provider: parse.sms.provider,
      trxId: parse.sms.trxId,
      amountPoisha: parse.sms.amountPoisha,
      senderPhoneMasked: parse.sms.senderPhoneMasked,
      transactionDate: parse.sms.transactionDate,
      reasons: match?.reasons ?? [],
      duplicate: match?.duplicate ?? false,
    },
    meta: { persistence: "database" },
  });
}
