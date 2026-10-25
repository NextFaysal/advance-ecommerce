import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { cashChannelInputSchema } from "@/bd/cash-closing";
import { buildDerivedClosing, deriveDrawerCash } from "@/bd/cash-closing-derive";
import { guardError, requireAdmin } from "@/reports/guard";
import { isValidYmd, todayDhakaYmd } from "@/lib/dhaka-date";

// Daily cash closing — Agent 11, Step 45 (E4); auto-derived cash
// channel added in doc 17 batch O8-2.
// RBAC: reports.accounting (compute, preview and list — money data).
// Persistence: DB-backed — closings live in daily_cash_closings,
// keyed by closingDate (UNIQUE): posting a closing for a date that
// already has one REPLACES that day's record (a re-count corrects
// the day, it does not stack a second closing).
// expected/actual store the CASH channel; differencePoisha stores the
// closing's total difference (actual − expected across channels).
//
// O8-2 change: the CASH expectation is no longer typed by staff. The
// POST body carries only physical facts (the counted drawer cash, an
// optional opening-count override, the other channels' expected /
// actual, and a note). The server derives the drawer expectation from
// the day's records (POS cash sales + rider COD hand-ins − cash
// refunds SENT — see src/bd/cash-closing-derive) and feeds it into
// the same buildDailyCashClosing() computation. A cash variance
// beyond tolerance REFUSES to save without a staff note: an
// unexplained difference is exactly what a closing exists to catch.
// The breakdown is returned with the response (and via GET ?date=)
// but is not persisted — DailyCashClosing has no JSON column; only
// the derived expected figure lands in expectedCashPoisha.
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

export async function GET(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const dateParam = new URL(req.url).searchParams.get("date");
  const previewDate = dateParam ?? todayDhakaYmd();
  if (!isValidYmd(previewDate)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "date must be a yyyy-mm-dd calendar day." } },
      { status: 400 },
    );
  }
  const [rows, derived] = await Promise.all([
    prisma.dailyCashClosing.findMany({ orderBy: { closingDate: "desc" } }),
    deriveDrawerCash(previewDate),
  ]);
  return NextResponse.json({
    data: { closings: rows.map(rowToStored), derived },
    meta: { persistence: "database" },
  });
}

const closingRequestSchema = z.object({
  /** yyyy-mm-dd, Asia/Dhaka business day. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Actual physical cash counted in the drawer at closing. */
  countedCashPoisha: z.number().int().nonnegative(),
  /** Optional physical opening count; defaults to the derived
   *  opening (previous closing's counted cash). */
  openingCashPoisha: z.number().int().nonnegative().optional(),
  bkash: cashChannelInputSchema,
  nagad: cashChannelInputSchema,
  courierCodReceivable: cashChannelInputSchema,
  /** Memo only: total customer khata due at end of day. */
  customerDuePoisha: z.number().int().nonnegative().default(0),
  tolerancePoisha: z.number().int().nonnegative().default(0),
  /** Sign-off note — REQUIRED when the cash channel varies. */
  note: z.string().trim().max(1000).optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = closingRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid cash closing input.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const { derived, closing } = await buildDerivedClosing(parsed.data);

  const cashChannel = closing.channels.find((c) => c.channel === "cash");
  const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null;
  if (cashChannel?.mismatch && !note) {
    return NextResponse.json(
      {
        error: {
          code: "NOTE_REQUIRED",
          message:
            "Cash counted differs from the system-derived expectation — a note explaining the variance is required to sign off. / গণনা করা নগদ সিস্টেমের হিসাবের সঙ্গে মেলেনি — পার্থক্যের কারণ লিখে নোট দেওয়া বাধ্যতামূলক।",
          details: { expectedCashPoisha: closing.expectedCashPoisha, countedCashPoisha: closing.countedCashPoisha, derived },
        },
      },
      { status: 400 },
    );
  }

  const closingDate = new Date(`${closing.date}T00:00:00.000Z`);
  await prisma.dailyCashClosing.upsert({
    where: { closingDate },
    create: {
      closingDate,
      openingCashPoisha: parsed.data.openingCashPoisha ?? derived.openingCashPoisha,
      expectedCashPoisha: closing.expectedCashPoisha,
      actualCashPoisha: closing.countedCashPoisha,
      differencePoisha: closing.totalDifferencePoisha,
      hasMismatch: closing.hasMismatch,
      breakdownJson: JSON.parse(JSON.stringify(derived)),
      note,
      closedById: guard.userId,
    },
    update: {
      openingCashPoisha: parsed.data.openingCashPoisha ?? derived.openingCashPoisha,
      expectedCashPoisha: closing.expectedCashPoisha,
      actualCashPoisha: closing.countedCashPoisha,
      differencePoisha: closing.totalDifferencePoisha,
      hasMismatch: closing.hasMismatch,
      breakdownJson: JSON.parse(JSON.stringify(derived)),
      note,
      closedById: guard.userId,
    },
  });
  return NextResponse.json({ data: { closing, derived }, meta: { persistence: "database" } }, { status: 201 });
}
