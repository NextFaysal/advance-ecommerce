import { NextResponse } from "next/server";
import { z } from "zod";
import { maskPhone } from "@/checkout/validation";
import { productApprovalTransition } from "@/vendors/service";
import type { VendorStatus } from "@/vendors/types";
import { requireVendorAdmin, vendorGuardError } from "../guard";
import { vendorApiStore } from "../store";

// One vendor — Agent 18. GET: vendor (masked phone) + its products with
// approval states. PATCH: vendor status transition and/or a product
// approval decision, both validated against the state machines in
// src/vendors/service.ts. Demo persistence, labelled.

const VENDOR_STATUS_TRANSITIONS: Record<VendorStatus, readonly VendorStatus[]> = {
  PENDING: ["ACTIVE", "REJECTED"],
  ACTIVE: ["SUSPENDED"],
  SUSPENDED: ["ACTIVE"],
  REJECTED: ["PENDING"],
};

const patchSchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"]).optional(),
  productApproval: z.object({
    productId: z.string().min(1),
    to: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
    rejectionReason: z.string().min(1).optional(),
  }).optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.view");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendor = vendorApiStore.getVendor(params.id);
  if (!vendor) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor not found." } }, { status: 404 });
  }
  return NextResponse.json({
    data: {
      vendor: { ...vendor, phone: maskPhone(vendor.phone) },
      products: vendorApiStore.listProducts(vendor.id),
    },
    meta: { persistence: "in-memory-demo" },
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.manage");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendor = vendorApiStore.getVendor(params.id);
  if (!vendor) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor not found." } }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid update.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  if (parsed.data.status) {
    if (!VENDOR_STATUS_TRANSITIONS[vendor.status].includes(parsed.data.status)) {
      return NextResponse.json(
        { error: { code: "INVALID_TRANSITION", message: `Vendor cannot move ${vendor.status} -> ${parsed.data.status}.` } },
        { status: 422 },
      );
    }
    vendorApiStore.setVendorStatus(vendor.id, parsed.data.status);
  }
  if (parsed.data.productApproval) {
    const { productId, to, rejectionReason } = parsed.data.productApproval;
    const product = vendorApiStore.getProduct(productId);
    if (!product || product.vendorId !== vendor.id) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor product not found." } }, { status: 404 });
    }
    if (!productApprovalTransition(product.approval, to)) {
      return NextResponse.json(
        { error: { code: "INVALID_TRANSITION", message: `Product cannot move ${product.approval} -> ${to}.` } },
        { status: 422 },
      );
    }
    if (to === "REJECTED" && !rejectionReason) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Rejecting a product requires a rejectionReason." } },
        { status: 400 },
      );
    }
    vendorApiStore.replaceProduct({ ...product, approval: to, rejectionReason });
  }
  const updated = vendorApiStore.getVendor(vendor.id);
  return NextResponse.json({
    data: {
      vendor: updated ? { ...updated, phone: maskPhone(updated.phone) } : null,
      products: vendorApiStore.listProducts(vendor.id),
    },
    meta: { persistence: "in-memory-demo" },
  });
}
