/**
 * Shared guard for the /api/v1/public/account/b2b/* routes (ADV-14).
 * Check order mirrors the B2B module guard (src/b2b/guard.ts):
 *   1. module.b2b_portal flag → 403 FEATURE_LOCKED (fail-closed)
 *   2. customer_session → 401 (requireCustomer from customer-auth)
 *   3. B2B profile by the session phone → 403 NOT_B2B_ACCOUNT
 * Every route re-runs this server-side; nothing trusts the client.
 */
import { NextResponse } from "next/server";
import { errorResponse, requireCustomer, unauthorized } from "@/customer-auth/http";
import type { PublicCustomer } from "@/customer-auth/auth";
import type { B2bCustomer } from "@/b2b/types";
import { getB2bProfileByPhone, isB2bPortalEnabled } from "@/b2b/portal";

export type B2bPortalGuard =
  | { ok: true; customer: PublicCustomer; profile: B2bCustomer }
  | { ok: false; response: NextResponse };

export async function requireB2bPortalCustomer(): Promise<B2bPortalGuard> {
  if (!isB2bPortalEnabled()) {
    return {
      ok: false,
      response: errorResponse(
        "FEATURE_LOCKED",
        "Module is locked: module.b2b_portal is off. It is a paid add-on — enable the feature flag to use it.",
        403,
      ),
    };
  }
  const customer = await requireCustomer();
  if (customer === null) return { ok: false, response: unauthorized() };
  const profile = await getB2bProfileByPhone(customer.phone);
  if (profile === null) {
    return {
      ok: false,
      response: errorResponse(
        "NOT_B2B_ACCOUNT",
        "এই অ্যাকাউন্টের সঙ্গে কোনো B2B (পাইকারি) প্রোফাইল যুক্ত নেই। / This account has no B2B profile.",
        403,
      ),
    };
  }
  return { ok: true, customer, profile };
}
