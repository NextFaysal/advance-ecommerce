import { NextResponse } from "next/server";
import { featureGuardError, requireFeatureAdmin } from "@/automation/guard";
import { maskPhone, normalizeBdPhone } from "@/checkout/validation";
import { demoFraudListStore } from "@/fraud/lists";
import { SCORE_WEIGHTS } from "@/fraud/scoring";
import { createListEntrySchema, type FraudListEntry } from "@/fraud/types";

// Fraud lists + scoring config — Agent 13, Step 43 (A2).
// Module is a paid add-on: every route first checks the module
// .fraud_scoring flag in the demo flag store (403 FEATURE_LOCKED when off).
// Phone entries are stored normalized and returned MASKED (full numbers
// need customers.view_full_phone, same rule as the customer module).
// Persistence is the in-memory demo store, labelled in meta.
// RBAC (pending catalogue addition, see src/automation/guard.ts):
// fraud.view for reads, fraud.manage for writes.

function presentEntry(entry: FraudListEntry): FraudListEntry {
  return entry.kind === "phone" ? { ...entry, value: maskPhone(entry.value) } : entry;
}

export async function GET() {
  const guard = await requireFeatureAdmin("module.fraud_scoring", "fraud.view");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const snapshot = demoFraudListStore.snapshot();
  return NextResponse.json({
    data: {
      weights: SCORE_WEIGHTS,
      bands: { low: "0-39 auto_confirm", medium: "40-69 manual_review", high: "70-89 require_advance, 90+ / blacklist block" },
      blacklist: snapshot.blacklist.map(presentEntry),
      whitelist: snapshot.whitelist.map(presentEntry),
    },
    meta: { persistence: "in-memory-demo" },
  });
}

export async function POST(req: Request) {
  const guard = await requireFeatureAdmin("module.fraud_scoring", "fraud.manage");
  if (!guard.ok) return NextResponse.json(featureGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createListEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid list entry.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const input = parsed.data;
  let value = input.value.trim();
  if (input.kind === "phone") {
    const normalized = normalizeBdPhone(input.value);
    if (!normalized) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Phone entries must be a valid BD mobile number." } },
        { status: 400 },
      );
    }
    value = normalized;
  }
  const entry: FraudListEntry = {
    id: `fl_${Date.now()}`,
    kind: input.kind,
    value,
    district: input.district,
    reason: input.reason,
    createdBy: guard.userId,
    createdAt: new Date().toISOString(),
  };
  demoFraudListStore.add(input.list, entry);
  return NextResponse.json(
    { data: { entry: presentEntry(entry), list: input.list }, meta: { persistence: "in-memory-demo" } },
    { status: 201 },
  );
}
