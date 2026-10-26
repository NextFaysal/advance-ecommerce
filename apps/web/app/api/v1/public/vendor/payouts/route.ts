import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isVendorPortalEnabled, VENDOR_SESSION_COOKIE, verifyVendorSessionToken } from "@/vendors/portal-auth";
import {
  createVendorPayoutRequestDb,
  getVendorPayoutBalancesDb,
  listVendorPayoutRequests,
} from "@/vendors/payout-store";
import { vendorPayoutRequestInputSchema } from "@/vendors/payouts";

// Vendor portal payout requests (schema wave 2) — mirrors the
// reseller portal route (ADV-12) exactly in shape and honesty.
// GET  — the signed-in vendor's own requests + computed balances.
// POST — create a request (PENDING). Availability is computed as
//        net payable − PAID − (PENDING + APPROVED) requests and
//        enforced inside a locked transaction (payout-store.ts).
//        Creating a request moves NO money; staff review it in
//        admin, and a PAID decision only records that staff paid
//        the vendor externally.
export const dynamic = "force-dynamic";

function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Vendor portal is locked for this install (module.vendor_portal is OFF)." } },
    { status: 403 },
  );
}

async function sessionVendorId(): Promise<string | null> {
  const store = await cookies();
  return verifyVendorSessionToken(store.get(VENDOR_SESSION_COOKIE)?.value);
}

export async function GET() {
  if (!isVendorPortalEnabled()) return locked();
  const vendorId = await sessionVendorId();
  if (!vendorId) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } }, { status: 401 });
  }
  const [requests, balances] = await Promise.all([
    listVendorPayoutRequests(vendorId),
    getVendorPayoutBalancesDb(vendorId),
  ]);
  return NextResponse.json({ data: { requests, balances }, meta: { persistence: "database" } });
}

export async function POST(req: Request) {
  if (!isVendorPortalEnabled()) return locked();
  const vendorId = await sessionVendorId();
  if (!vendorId) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } }, { status: 401 });
  }
  const parsed = vendorPayoutRequestInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "সঠিক পরিমাণ, মাধ্যম ও অ্যাকাউন্ট তথ্য দিন।", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const result = await createVendorPayoutRequestDb({
    vendorId,
    amountPoisha: parsed.data.amountPoisha,
    method: parsed.data.method,
    accountNote: parsed.data.accountNote,
  });
  if (!result.ok) {
    return NextResponse.json({ error: { code: "PAYOUT_REJECTED", message: result.error } }, { status: 422 });
  }
  return NextResponse.json({ data: { request: result.request }, meta: { persistence: "database" } }, { status: 201 });
}
