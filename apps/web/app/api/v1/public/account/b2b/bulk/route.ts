/**
 * POST /api/v1/public/account/b2b/bulk — bulk order form submission
 * (ADV-14 remainder): pasted or uploaded CSV rows of `sku,quantity`
 * (variant SKUs). Every row is validated against the catalogue and
 * reported back with its errors/warnings — nothing is silently
 * dropped. The valid rows create ONE DRAFT quotation for the buyer
 * (a buyer RFQ, source-marked like the RFQ form; staff price/send it
 * from the admin quotations list). When no row is valid, nothing is
 * created (422 + the full row report).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, methodNotAllowed } from "@/customer-auth/http";
import { getB2bPortalQuotation } from "@/b2b/portal";
import { createB2bQuotationRequest, parseB2bBulkCsv } from "@/b2b/requests";
import { requireB2bPortalCustomer } from "../guard";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "desiredDate must be yyyy-mm-dd")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "desiredDate must be a real calendar date");

const bodySchema = z.object({
  csvText: z.string().min(1).max(256_000),
  note: z.string().trim().max(2_000).optional(),
  desiredDate: dateSchema.nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requireB2bPortalCustomer();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Invalid bulk submission.", 400, parsed.error.issues);
  }

  const { inputs, fatalError } = parseB2bBulkCsv(parsed.data.csvText);
  if (fatalError !== null) {
    return errorResponse("CSV_INVALID", fatalError, 400);
  }

  const result = await createB2bQuotationRequest({
    customerId: guard.customer.id,
    profile: guard.profile,
    inputs,
    note: parsed.data.note,
    desiredDate: parsed.data.desiredDate ?? null,
    channel: "BULK_CSV",
  });
  if (!result.ok) {
    return errorResponse(result.code, result.message, result.httpStatus, {
      rows: result.resolution?.rows ?? [],
    });
  }

  const quotation =
    (await getB2bPortalQuotation(guard.profile, result.quotation.id)) ?? result.quotation;
  return NextResponse.json(
    {
      data: {
        quotation,
        rows: result.resolution.rows,
      },
      meta: {
        persistence: "database",
        source: "BUYER_RFQ",
        channel: "BULK_CSV",
        validRows: result.resolution.validCount,
        errorRows: result.resolution.errorCount,
        pricing: "group price snapshotted into the quotation lines at submission",
      },
    },
    { status: 201 },
  );
}

export function GET() {
  return methodNotAllowed();
}
