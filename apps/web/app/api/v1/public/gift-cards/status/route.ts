import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { isFeatureEnabled } from "@/lib/feature-flags";

// GET /api/v1/public/gift-cards/status (ADV-18) — the ONLY public
// gift-card surface besides the checkout attempt itself. It reports
// whether the module is on so the checkout page can render the code
// field; it accepts NO code parameter and reveals nothing about any
// card. Code validation happens exclusively inside a checkout
// attempt (rate-limited per IP+phone in the orders route) — there is
// deliberately no balance oracle for arbitrary codes.
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDbFeatureFlags().catch(() => {});
  return NextResponse.json({
    data: { enabled: isFeatureEnabled("module.marketing_mechanics") },
  });
}
