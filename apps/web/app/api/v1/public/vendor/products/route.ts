import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { vendorStore } from "@/vendors/db-store";
import { isVendorPortalEnabled, VENDOR_SESSION_COOKIE, verifyVendorSessionToken } from "@/vendors/portal-auth";

// Vendor product submission (ADV-13) — a signed-in vendor submits a
// listing into the staff approval queue (VendorProduct with
// approval PENDING_REVIEW — the same queue the admin vendors page
// and PATCH /api/v1/admin/vendors/[id] decide on). Portal
// submissions are FREE-STANDING listings (no catalog product/variant
// link): staff link them to the catalog during approval, which is
// also when stock starts being tracked via the variant.
export const dynamic = "force-dynamic";

const submitSchema = z.object({
  productName: z.string().min(2).max(120),
  sku: z.string().min(1).max(64),
  pricePoisha: z.number().int().positive().max(100_000_000),
});

export async function POST(req: Request) {
  if (!isVendorPortalEnabled()) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Vendor portal is locked for this install (module.vendor_portal is OFF)." } },
      { status: 403 },
    );
  }
  const store = await cookies();
  const vendorId = await verifyVendorSessionToken(store.get(VENDOR_SESSION_COOKIE)?.value);
  if (!vendorId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } },
      { status: 401 },
    );
  }
  const vendor = await vendorStore.getVendor(vendorId);
  if (!vendor) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "পণ্যের নাম, SKU ও সঠিক দাম দিন।", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const saved = await vendorStore.addProduct({
    id: `vproduct_${Date.now()}`,
    vendorId,
    productName: parsed.data.productName,
    sku: parsed.data.sku,
    pricePoisha: parsed.data.pricePoisha,
    approval: "PENDING_REVIEW",
  });
  return NextResponse.json(
    {
      data: { product: saved },
      meta: {
        persistence: "database",
        note: "Free-standing listing in the staff approval queue; staff link it to a catalog variant during approval.",
      },
    },
    { status: 201 },
  );
}
