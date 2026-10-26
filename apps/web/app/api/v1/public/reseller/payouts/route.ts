import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isResellerPortalEnabled } from "@/reseller/flags";
import { createPayoutRequestDb, listPayoutRequests } from "@/reseller/payout-store";
import { payoutRequestInputSchema } from "@/reseller/payouts";
import { RESELLER_SESSION_COOKIE, verifyResellerSessionToken } from "@/reseller/portal-auth";

// Reseller portal payout requests (ADV-12).
// GET  — the signed-in reseller's own requests.
// POST — create a request (PENDING). Availability is computed as
//        wallet balance − PAID − (PENDING + APPROVED) requests and
//        enforced inside a locked transaction (payout-store.ts).
//        Creating a request moves NO money; staff review it in admin.
export const dynamic = "force-dynamic";

function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Reseller portal is locked for this install (module.reseller_portal is OFF)." } },
    { status: 403 },
  );
}

async function sessionResellerId(): Promise<string | null> {
  const store = await cookies();
  return await verifyResellerSessionToken(store.get(RESELLER_SESSION_COOKIE)?.value);
}

export async function GET() {
  if (!isResellerPortalEnabled()) return locked();
  const resellerId = await sessionResellerId();
  if (!resellerId) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } }, { status: 401 });
  }
  const requests = await listPayoutRequests(resellerId);
  return NextResponse.json({ data: { requests }, meta: { persistence: "database" } });
}

export async function POST(req: Request) {
  if (!isResellerPortalEnabled()) return locked();
  const resellerId = await sessionResellerId();
  if (!resellerId) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } }, { status: 401 });
  }
  const parsed = payoutRequestInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "সঠিক পরিমাণ, মাধ্যম ও অ্যাকাউন্ট তথ্য দিন।", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const result = await createPayoutRequestDb({
    resellerId,
    amountPoisha: parsed.data.amountPoisha,
    method: parsed.data.method,
    accountNote: parsed.data.accountNote,
  });
  if (!result.ok) {
    return NextResponse.json({ error: { code: "PAYOUT_REJECTED", message: result.error } }, { status: 422 });
  }
  return NextResponse.json({ data: { request: result.request }, meta: { persistence: "database" } }, { status: 201 });
}
