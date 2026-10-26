import { NextResponse } from "next/server";
import { z } from "zod";
import { b2bGuardError, requireB2bAdmin } from "@/b2b/guard";
import { b2bStore } from "@/b2b/db-store";
import { readB2bRequestMetaMap } from "@/b2b/requests";
import { createQuotationSchema, type Quotation } from "@/b2b/types";
import { effectiveQuotationStatus, quotationTotalPoisha, quotationTransition } from "@/b2b/service";

// B2B quotations — Agent 16. Flow: DRAFT -> SENT -> ACCEPTED -> CONVERTED
// (to an order, by the order service — conversion itself is not done here),
// or REJECTED / EXPIRED. DB-backed (Prisma) since 2026-10-24.

export async function GET() {
  const guard = await requireB2bAdmin("b2b.view");
  if (!guard.ok) return NextResponse.json(b2bGuardError(guard), { status: guard.status });
  const today = new Date().toISOString().slice(0, 10);
  const [stored, requestMeta] = await Promise.all([
    b2bStore.listQuotations(),
    readB2bRequestMetaMap(),
  ]);
  const quotations = stored.map((q) => {
    const request = requestMeta[q.id] ?? null;
    return {
      ...q,
      // Buyer RFQs are distinctly marked: `source` + the request
      // marker (note / desired date / channel). Staff-created
      // quotations read STAFF_CREATED with request: null.
      source: request !== null ? "BUYER_RFQ" : "STAFF_CREATED",
      request,
      // A DRAFT buyer RFQ is a request, not an offer — its stored
      // validUntil is a placeholder, so it never reads EXPIRED
      // while waiting for staff pricing (src/b2b/requests.ts).
      effectiveStatus:
        request !== null && q.status === "DRAFT"
          ? "DRAFT"
          : effectiveQuotationStatus(q, today),
    };
  });
  return NextResponse.json({ data: { quotations }, meta: { persistence: "database" } });
}

export async function POST(req: Request) {
  const guard = await requireB2bAdmin("b2b.manage");
  if (!guard.ok) return NextResponse.json(b2bGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createQuotationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid quotation.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  if (!(await b2bStore.getCustomer(parsed.data.b2bCustomerId))) {
    return NextResponse.json(
      { error: { code: "CUSTOMER_NOT_FOUND", message: "B2B customer not found." } },
      { status: 404 },
    );
  }
  const now = new Date().toISOString();
  const quotation: Quotation = {
    id: `quo_${Date.now()}`,
    ...parsed.data,
    totalPoisha: quotationTotalPoisha(parsed.data.lines),
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
  };
  const saved = await b2bStore.addQuotation(quotation);
  return NextResponse.json({ data: { quotation: saved }, meta: { persistence: "database" } }, { status: 201 });
}

const transitionSchema = z.object({
  quotationId: z.string().min(1),
  to: z.enum(["SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"]),
  convertedOrderId: z.string().min(1).optional(),
});

export async function PATCH(req: Request) {
  const guard = await requireB2bAdmin("b2b.manage");
  if (!guard.ok) return NextResponse.json(b2bGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = transitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid transition.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const quotation = await b2bStore.getQuotation(parsed.data.quotationId);
  if (!quotation) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Quotation not found." } }, { status: 404 });
  }
  if (!quotationTransition(quotation.status, parsed.data.to)) {
    return NextResponse.json(
      { error: { code: "INVALID_TRANSITION", message: `Quotation cannot move ${quotation.status} -> ${parsed.data.to}.` } },
      { status: 422 },
    );
  }
  if (parsed.data.to === "CONVERTED" && !parsed.data.convertedOrderId) {
    return NextResponse.json(
      { error: { code: "ORDER_ID_REQUIRED", message: "CONVERTED requires the convertedOrderId created by the order service." } },
      { status: 422 },
    );
  }
  const updated: Quotation = {
    ...quotation,
    status: parsed.data.to,
    convertedOrderId: parsed.data.convertedOrderId ?? quotation.convertedOrderId,
    updatedAt: new Date().toISOString(),
  };
  await b2bStore.replaceQuotation(updated);
  return NextResponse.json({ data: { quotation: updated }, meta: { persistence: "database" } });
}
