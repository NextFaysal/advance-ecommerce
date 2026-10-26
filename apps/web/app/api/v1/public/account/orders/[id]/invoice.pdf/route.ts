/**
 * GET /api/v1/public/account/orders/[id]/invoice.pdf — ADV-29.
 *
 * The customer's own invoice PDF. Ownership is strict — the
 * order's customerId must equal the session customer, exactly like
 * the returns/reorder routes: another customer's order id returns
 * the same 404 as a non-existent one (no enumeration). The phone
 * on paper is the customer's own number MASKED, matching the
 * account order list's display policy. Same read model + renderer
 * as the admin invoice (src/pdf/invoice-data.ts) — one invoice,
 * two doors.
 */
import { NextResponse } from "next/server";
import { errorResponse, requireCustomer, unauthorized } from "@/customer-auth/http";
import { getOrderByIdOrNo } from "@/orders/repository";
import { maskPhone } from "@/checkout/validation";
import { buildInvoiceData } from "@/pdf/invoice-data";
import { renderInvoicePdf } from "@/pdf/invoice";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const order = await getOrderByIdOrNo(params.id);
  if (!order || order.customerId !== customer.id) {
    return errorResponse("ORDER_NOT_FOUND", "Order not found.", 404);
  }
  const data = await buildInvoiceData(order.id, maskPhone(order.customerPhone));
  if (!data) return errorResponse("ORDER_NOT_FOUND", "Order not found.", 404);
  const pdf = await renderInvoicePdf(data, new Date());
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${data.orderNo}.pdf"`,
    },
  });
}
