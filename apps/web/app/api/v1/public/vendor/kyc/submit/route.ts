import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isVendorPortalEnabled, VENDOR_SESSION_COOKIE, verifyVendorSessionToken } from "@/vendors/portal-auth";
import { canVendorSubmitKyc } from "@/vendors/kyc";
import { getVendorKyc, setVendorKyc } from "@/vendors/kyc-store";

// Vendor KYC submission (ADV-13) — the vendor marks their KYC as
// submitted (NOT_SUBMITTED / DOCUMENTS_REQUESTED / REJECTED ->
// PENDING). Document UPLOAD is not part of this: there is nowhere
// to store document files yet (see src/vendors/kyc.ts header) —
// staff verify documents off-system and record the decision via
// the admin KYC route. The submission itself is real state.
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isVendorPortalEnabled()) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Vendor portal is locked for this install (module.vendor_portal is OFF)." } },
      { status: 403 },
    );
  }
  const store = await cookies();
  const vendorId = verifyVendorSessionToken(store.get(VENDOR_SESSION_COOKIE)?.value);
  if (!vendorId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } },
      { status: 401 },
    );
  }
  const current = await getVendorKyc(vendorId);
  if (!canVendorSubmitKyc(current.status)) {
    return NextResponse.json(
      { error: { code: "KYC_NOT_SUBMITTABLE", message: "এই অবস্থায় KYC আবার জমা দেওয়া যায় না।" } },
      { status: 409 },
    );
  }
  const now = new Date().toISOString();
  const record = await setVendorKyc(
    { ...current, status: "PENDING", submittedAt: now, updatedAt: now, updatedById: null },
    vendorId,
  );
  return NextResponse.json({ data: { kyc: record }, meta: { persistence: "database" } });
}
