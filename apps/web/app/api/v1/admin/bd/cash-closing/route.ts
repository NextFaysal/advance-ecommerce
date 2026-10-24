import { NextResponse } from "next/server";
import { buildDailyCashClosing, dailyCashClosingInputSchema } from "@/bd/cash-closing";
import { guardError, requireAdmin } from "@/reports/guard";

// Daily cash closing — Agent 11, Step 45 (E4).
// RBAC: reports.accounting (both compute and list — this is money data).
// Persistence: IN-MEMORY-DEMO only. A closing computed here is kept in a
// process-local array, lost on restart, and flagged as such in meta.
// The DB version is a daily_cash_closings table keyed by date (unique),
// written inside the same transaction as its audit record.
interface StoredClosing {
  date: string;
  hasMismatch: boolean;
  totalDifferencePoisha: number;
  createdAt: string;
}
const demoClosings: StoredClosing[] = [];

export async function GET() {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return NextResponse.json({ data: { closings: demoClosings }, meta: { persistence: "in-memory-demo" } });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = dailyCashClosingInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid cash closing input.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const closing = buildDailyCashClosing(parsed.data);
  demoClosings.push({
    date: closing.date,
    hasMismatch: closing.hasMismatch,
    totalDifferencePoisha: closing.totalDifferencePoisha,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ data: { closing }, meta: { persistence: "in-memory-demo" } }, { status: 201 });
}
