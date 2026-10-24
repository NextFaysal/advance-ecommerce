import { NextResponse } from "next/server";
import { z } from "zod";
import { maskPhone, normalizeBdPhone } from "@/checkout/validation";
import { demoVendorFlags } from "@/vendors/flags";
import type { Vendor } from "@/vendors/types";
import { requireVendorAdmin, vendorGuardError } from "./guard";
import { vendorApiStore } from "./store";

// Vendors — Agent 18 (follow-up to Agent 16's src-only vendors module).
// Paid add-on: module.multi_vendor is checked first by the guard (403
// FEATURE_LOCKED when off). Phones are masked in every response; the full
// number is never returned by these routes. Vendor records are
// DB-backed (Prisma) since 2026-10-24.

const createVendorSchema = z.object({
  shopName: z.string().min(2),
  ownerName: z.string().min(2),
  phone: z.string().min(11),
  commissionBps: z.number().int().min(0).max(10000).default(1000),
});

export async function GET() {
  const guard = await requireVendorAdmin("vendors.view");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendors = (await vendorApiStore.listVendors()).map((v) => ({ ...v, phone: maskPhone(v.phone) }));
  return NextResponse.json({
    data: { flags: demoVendorFlags.list(), vendors },
    meta: { persistence: "database" },
  });
}

export async function POST(req: Request) {
  const guard = await requireVendorAdmin("vendors.manage");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createVendorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid vendor.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const phone = normalizeBdPhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Phone must be a valid BD number (01[3-9]XXXXXXXX)." } },
      { status: 400 },
    );
  }
  const vendor: Vendor = {
    id: `vendor_${Date.now()}`,
    shopName: parsed.data.shopName,
    ownerName: parsed.data.ownerName,
    phone,
    status: "PENDING",
    commissionBps: parsed.data.commissionBps,
    createdAt: new Date().toISOString(),
  };
  const saved = await vendorApiStore.addVendor(vendor);
  return NextResponse.json(
    { data: { vendor: { ...saved, phone: maskPhone(saved.phone) } }, meta: { persistence: "database" } },
    { status: 201 },
  );
}
