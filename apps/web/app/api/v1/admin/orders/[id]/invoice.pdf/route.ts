/**
 * GET /api/v1/admin/orders/[id]/invoice.pdf — ADV-29 (doc 22).
 *
 * The invoice as a real PDF, rendered from the SAME read models as
 * the detail screen + print centre (src/pdf/invoice-data.ts), so
 * the numbers can never diverge from what staff see. Guard:
 * orders.view (same as the detail API). The phone on paper follows
 * the detail API's own policy — full only for holders of
 * customers.view_full_phone, masked otherwise (phoneForViewer).
 * The download is audited (orders.invoice_pdf).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { phoneForViewer, requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { getOrderByIdOrNo } from "@/orders/repository";
import { buildInvoiceData } from "@/pdf/invoice-data";
import { renderInvoicePdf } from "@/pdf/invoice";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return err("UNAUTHENTICATED", "Admin login required.", 401);
  let userId: string;
  let phoneDisplay: string;
  try {
    const session = await validateSessionToken(token);
    if (!session) return err("UNAUTHENTICATED", "Session expired or revoked.", 401);
    requirePermission(session.user.permissions, "orders.view");
    userId = session.user.id;
    const order = await getOrderByIdOrNo(params.id);
    if (!order) return err("NOT_FOUND", "Order not found.", 404);
    phoneDisplay = phoneForViewer(order.customerPhone, session.user.permissions) ?? "";
    const data = await buildInvoiceData(order.id, phoneDisplay);
    if (!data) return err("NOT_FOUND", "Order not found.", 404);
    const pdf = await renderInvoicePdf(data, new Date());
    await writeAudit({
      actorId: userId,
      action: "orders.invoice_pdf",
      entityType: "order",
      entityId: data.orderId,
      afterJson: { orderNo: data.orderNo, totalPoisha: data.totalPoisha },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    }).catch(() => null);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${data.orderNo}.pdf"`,
      },
    });
  } catch (e) {
    if (e instanceof RbacError) return err("FORBIDDEN", e.message, 403);
    throw e;
  }
}
