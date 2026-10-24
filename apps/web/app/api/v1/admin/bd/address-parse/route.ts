import { NextResponse } from "next/server";
import { z } from "zod";
import { parseAddress } from "@/bd/address-parser";
import { guardError, requireAdmin } from "@/reports/guard";

// POST /api/v1/admin/bd/address-parse — Agent 11, Step 44 (E2).
// RBAC: orders.create (the parser feeds the manual-order flow).
// Pure logic, no persistence. Low confidence (< 0.5) is returned, never
// hidden — the caller must show it to staff for confirmation.
const bodySchema = z.object({ text: z.string().min(5).max(1000) });

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Address text required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const result = parseAddress(parsed.data.text);
  return NextResponse.json({
    data: { parsed: result, needsStaffConfirmation: result.confidence < 0.5 },
    meta: { persistence: "none-pure-logic" },
  });
}
