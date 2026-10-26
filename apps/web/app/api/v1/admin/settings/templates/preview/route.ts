/**
 * Template-designer invoice preview — GET
 * /api/v1/admin/settings/templates/preview (ADV-29, doc 23 wave 53).
 *
 * Renders the invoice template against the MOST RECENT real order,
 * through the exact read model the PDF uses (buildInvoiceData), so
 * the preview shows the saved template overrides on real data.
 * The customer's phone is passed MASKED — the preview is about
 * template copy, and settings.view does not imply
 * customers.view_full_phone.
 *
 * When the shop has no orders yet, a clearly-labelled SAMPLE
 * document is composed instead (orderNo "SAMPLE-0000", sample
 * names/items, `sample: true` in the response and "নমুনা / SAMPLE"
 * baked into the sample's customer name) — never passed off as a
 * real order.
 *
 * Guard: settings.view (same as the templates GET).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { buildInvoiceData, computeInvoiceMoneyRows, type InvoiceData } from "@/pdf/invoice-data";
import { getSetting } from "@/lib/settings";
import { resolveInvoiceTexts } from "@/templates/overrides";
import { maskPhone } from "@/checkout/validation";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function sampleInvoiceData(): Promise<InvoiceData> {
  const [storeName, storeAddress, storeBin, texts] = await Promise.all([
    getSetting("general.store_name"),
    getSetting("general.store_address"),
    getSetting("general.store_bin"),
    resolveInvoiceTexts(),
  ]);
  const subtotal = 245000;
  const shipping = 6000;
  const total = subtotal + shipping;
  return {
    orderId: "sample",
    orderNo: "SAMPLE-0000",
    status: "CONFIRMED",
    paymentStatus: "UNPAID",
    paymentMethodLabel: "Cash on Delivery (COD)",
    createdAtLabel: "—",
    storeName: (storeName ?? "").trim(),
    storeAddress: (storeAddress ?? "").trim(),
    storeBin: (storeBin ?? "").trim(),
    customerName: "নমুনা কাস্টমার / SAMPLE CUSTOMER",
    customerPhone: "01•• •••• ••00 (নমুনা)",
    addressText: "নমুনা ঠিকানা / Sample address, Dhaka",
    giftMessage: null,
    items: [
      { productName: "নমুনা পণ্য / Sample product", sku: "SAMPLE-1", quantity: 1, unitPricePoisha: subtotal, lineTotalPoisha: subtotal },
    ],
    moneyRows: computeInvoiceMoneyRows({
      subtotalPoisha: subtotal,
      discountPoisha: 0,
      shippingPoisha: shipping,
      totalPoisha: total,
      giftCardNetPoisha: 0,
      giftCardLast4: null,
      paidPoisha: 0,
    }),
    totalPoisha: total,
    headerNote: texts.headerNote,
    footerNote: texts.footerNote,
    termsLine: texts.termsLine,
  };
}

export async function GET() {
  const token = cookies().get("admin_session")?.value;
  if (!token) return err("UNAUTHENTICATED", "Admin login required.", 401);
  try {
    const session = await validateSessionToken(token);
    if (!session) return err("UNAUTHENTICATED", "Session expired or revoked.", 401);
    requirePermission(session.user.permissions, "settings.view");
  } catch (e) {
    if (e instanceof RbacError) return err("FORBIDDEN", e.message, 403);
    return err("DB_NOT_READY", "Session check needs a working database.", 503);
  }

  const latest = await prisma.order.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, customerPhone: true },
  });
  if (latest === null) {
    return NextResponse.json({
      data: { invoice: await sampleInvoiceData(), sample: true },
      meta: { source: "sample" },
    });
  }
  const data = await buildInvoiceData(latest.id, maskPhone(latest.customerPhone));
  if (data === null) {
    return NextResponse.json({
      data: { invoice: await sampleInvoiceData(), sample: true },
      meta: { source: "sample" },
    });
  }
  return NextResponse.json({
    data: { invoice: data, sample: false },
    meta: { source: "database" },
  });
}
