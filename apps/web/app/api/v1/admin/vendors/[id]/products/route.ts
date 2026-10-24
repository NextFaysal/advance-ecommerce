import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import type { VendorProduct } from "@/vendors/types";
import { requireVendorAdmin, vendorGuardError } from "../../guard";
import { vendorApiStore } from "../../store";

// Vendor product submission — creates a VendorProduct row in
// PENDING_REVIEW; the approval decision itself goes through the
// existing PATCH /vendors/[id] productApproval flow (state machine in
// src/vendors/service.ts). productId / variantId link the listing to
// the core catalog when known; a variantId, when supplied, must exist
// and pins productId to the variant's product. DB-backed
// (advanced_modules_completion migration, 2026-10-25).

const createProductSchema = z.object({
  productName: z.string().min(2),
  sku: z.string().min(1),
  pricePoisha: z.number().int().nonnegative(),
  productId: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.manage");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendor = await vendorApiStore.getVendor(params.id);
  if (!vendor) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor not found." } }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid vendor product.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  let { productId } = parsed.data;
  const { variantId } = parsed.data;
  if (variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, deletedAt: null },
      select: { id: true, productId: true },
    });
    if (!variant) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "variantId does not match a catalog variant." } },
        { status: 400 },
      );
    }
    if (productId && productId !== variant.productId) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "productId does not match the variant's product." } },
        { status: 400 },
      );
    }
    productId = variant.productId;
  } else if (productId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "productId does not match a catalog product." } },
        { status: 400 },
      );
    }
  }
  const product: VendorProduct = {
    id: `vprod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    vendorId: vendor.id,
    productName: parsed.data.productName,
    sku: parsed.data.sku,
    pricePoisha: parsed.data.pricePoisha,
    approval: "PENDING_REVIEW",
    ...(productId ? { productId } : {}),
    ...(variantId ? { variantId } : {}),
  };
  const saved = await vendorApiStore.addProduct(product);
  return NextResponse.json(
    { data: { product: saved }, meta: { persistence: "database" } },
    { status: 201 },
  );
}
