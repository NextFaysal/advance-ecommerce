import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { buildDailyCashClosing, dailyCashClosingInputSchema } from "@/bd/cash-closing";
import { guardError, requireAdmin } from "@/reports/guard";

// Daily cash closing — Agent 11, Step 45 (E4).
// RBAC: reports.accounting (both compute and list — this is money data).
// Persistence: DB-backed (DB swap 2026-10-24) — closings live in the
// daily_cash_closings table, keyed by closingDate (UNIQUE): posting a
// closing for a date that already has one REPLACES that day's record
// (a re-count corrects the day, it does not stack a second closing).
// expected/actual store the CASH channel; differencePoisha stores the
// closing's total difference (actual − expected across channels), so
// the GET read-back keeps the exact field semantics the demo store
// returned. Per-channel detail stays in the POST response.
interface StoredClosing {
  date: string;
  hasMismatch: boolean;
  totalDifferencePoisha: number;
  createdAt: string;
}

function rowToStored(row: {
  closingDate: Date;
  hasMismatch: boolean;
  differencePoisha: number;
  createdAt: Date;
}): StoredClosing {
  return {
    date: row.closingDate.toISOString().slice(0, 10),
    hasMismatch: row.hasMismatch,
    totalDifferencePoisha: row.differencePoisha,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET() {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const rows = await prisma.dailyCashClosing.findMany({ orderBy: { closingDate: "desc" } });
  return NextResponse.json({
    data: { closings: rows.map(rowToStored) },
    meta: { persistence: "database" },
  });
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
  const closingDate = new Date(`${closing.date}T00:00:00.000Z`);
  await prisma.dailyCashClosing.upsert({
    where: { closingDate },
    create: {
      closingDate,
      openingCashPoisha: parsed.data.openingCashPoisha,
      expectedCashPoisha: closing.expectedCashPoisha,
      actualCashPoisha: closing.countedCashPoisha,
      differencePoisha: closing.totalDifferencePoisha,
      hasMismatch: closing.hasMismatch,
      closedById: guard.userId,
    },
    update: {
      openingCashPoisha: parsed.data.openingCashPoisha,
      expectedCashPoisha: closing.expectedCashPoisha,
      actualCashPoisha: closing.countedCashPoisha,
      differencePoisha: closing.totalDifferencePoisha,
      hasMismatch: closing.hasMismatch,
      closedById: guard.userId,
    },
  });
  return NextResponse.json({ data: { closing }, meta: { persistence: "database" } }, { status: 201 });
}
