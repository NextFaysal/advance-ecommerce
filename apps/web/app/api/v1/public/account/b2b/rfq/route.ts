/**
 * POST /api/v1/public/account/b2b/rfq — the buyer submits a request
 * for quotation (ADV-14 remainder). Creates a DRAFT Quotation (the
 * codebase's unpriced/draft state) whose lines snapshot the buyer's
 * group price, plus a BUYER_RFQ source marker in the
 * `b2b.rfq_requests` Setting doc that staff see in the admin
 * quotations list (src/b2b/requests.ts).
 *
 * Response honesty: EVERY submitted row is reported back (valid or
 * with its error codes). A request is created from the valid rows
 * even when sibling rows failed (201 + rows); when no row is valid,
 * nothing is created (422 + rows).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, methodNotAllowed } from "@/customer-auth/http";
import { getB2bPortalQuotation } from "@/b2b/portal";
import { createB2bQuotationRequest } from "@/b2b/requests";
import { requireB2bPortalCustomer } from "../guard";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "desiredDate must be yyyy-mm-dd")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "desiredDate must be a real calendar date");

const bodySchema = z.object({
  items: z
    .array(
      z
        .object({
          variantId: z.string().trim().min(1).optional(),
          sku: z.string().trim().min(1).optional(),
          quantity: z.number().int().positive().max(1_000_000),
        })
        .refine((item) => item.variantId !== undefined || item.sku !== undefined, {
          message: "Each item needs a variantId or a sku.",
        }),
    )
    .min(1)
    .max(100),
  note: z.string().trim().max(2_000).optional(),
  desiredDate: dateSchema.nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requireB2bPortalCustomer();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Invalid RFQ submission.", 400, parsed.error.issues);
  }

  const result = await createB2bQuotationRequest({
    customerId: guard.customer.id,
    profile: guard.profile,
    inputs: parsed.data.items.map((item, i) => ({
      rowNumber: i + 1,
      variantId: item.variantId,
      sku: item.sku,
      quantity: item.quantity,
    })),
    note: parsed.data.note,
    desiredDate: parsed.data.desiredDate ?? null,
    channel: "PORTAL_FORM",
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
