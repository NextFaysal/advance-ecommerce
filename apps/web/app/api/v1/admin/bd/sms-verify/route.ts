import { NextResponse } from "next/server";
import { autoVerifySms, demoTrxRegistry, parseMerchantSmsInputSchema } from "@/bd/sms-autoverify";
import { guardError, requireAdmin } from "@/reports/guard";

// POST /api/v1/admin/bd/sms-verify — Agent 11, Step 44 (E1).
// RBAC: payments.verify_manual.
// Persistence: the duplicate-Trx registry is IN-MEMORY-DEMO only
// (demoTrxRegistry). The DB version must enforce UNIQUE(method, trxId).
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
  const { parse, match } = autoVerifySms(
    smsText,
    { orderId, amountPoisha: expectedAmountPoisha, customerPhone: customerPhone ?? null },
    demoTrxRegistry,
    providerHint,
  );
  if (!parse.ok) {
    return NextResponse.json({
      data: { verified: false, parseReason: parse.reason },
      meta: { persistence: "in-memory-demo" },
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
    meta: { persistence: "in-memory-demo" },
  });
}
