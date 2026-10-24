// COD settlement report (sandbox) — Agent 9, Step 22.
// GET /api/v1/admin/payments/cod-settlement?provider=steadfast|pathao|redx|all
// Permission: payments.view. Data aggregates the persisted Shipment rows
// (simulated bookings only, sandbox: true in the response) and is
// reconciled against the courier invoice in bd/courier-reconciliation.ts
// — see src/integrations/sandbox/cod-settlement.ts.
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import { buildCodSettlementReport } from "@/integrations/sandbox/cod-settlement";

const PROVIDERS = ["steadfast", "pathao", "redx", "paperfly", "ecourier", "all"] as const;

export async function GET(req: Request) {
  const guard = await requireAdminPermission("payments.view");
  if (!guard.ok) {
    return NextResponse.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.httpStatus },
    );
  }
  const provider = new URL(req.url).searchParams.get("provider") ?? "all";
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Unknown courier provider." } },
      { status: 400 },
    );
  }
  return NextResponse.json({ data: await buildCodSettlementReport(provider) });
}
