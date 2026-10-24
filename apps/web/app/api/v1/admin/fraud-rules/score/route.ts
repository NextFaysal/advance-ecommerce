import { NextResponse } from "next/server";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { normalizeBdPhone } from "@/checkout/validation";
import { demoFraudListStore } from "@/fraud/lists";
import { scoreFraud } from "@/fraud/scoring";
import { fraudScoreRequestSchema } from "@/fraud/types";

// Fraud score — Agent 13. POST an order's scoring input, get back the
// assessment (score, level, suggested action, OTP requirement, per-signal
// explanation, masked phone). If the body omits `lists`, the demo store's
// current blacklist/whitelist snapshot is used. This route scores only —
// applying the suggested action (auto-confirm, advance, block) is the
// order service's decision, enforced server-side there.

export async function POST(req: Request) {
  const guard = await requireFeatureAdmin("module.fraud_scoring", "fraud.view");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (raw["lists"] === undefined) raw["lists"] = demoFraudListStore.snapshot();
  if (raw["now"] === undefined) raw["now"] = new Date().toISOString();
  const parsed = fraudScoreRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid scoring input.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const phone = normalizeBdPhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "A valid BD mobile number is required." } },
      { status: 400 },
    );
  }
  const assessment = scoreFraud({ ...parsed.data, phone });
  return NextResponse.json({
    data: { assessment },
    meta: { persistence: "in-memory-demo", applied: false },
  });
}
