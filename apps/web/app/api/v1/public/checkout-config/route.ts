/**
 * GET /api/v1/public/checkout-config — the storefront checkout's
 * field configuration (doc 28): labels, placeholders, visibility,
 * required flags and the merchant's extra fields, in render order.
 *
 * Public by design: this is display data the checkout renders
 * anyway (the same pattern as the public restaurant config). It
 * carries NO secrets — the checkout.fields document holds only
 * field presentation. The orders route re-enforces the same config
 * server-side (hidden fields treated as absent, required fields
 * refused when missing), so a forged or stale copy here cannot
 * smuggle a value past the rules. Edge-cached (perf wave 2B:
 * s-maxage=300 + SWR 600): the config is identical for every visitor
 * and the landing quick-order form fetches it on every render; an
 * admin edit can take up to ~5 minutes to reach every visitor,
 * which is safe precisely because the orders route re-enforces the
 * live config server-side. Reads are fail-soft — a
 * missing/corrupt doc resolves to the default config, which is the
 * original hardcoded form.
 */
import { NextResponse } from "next/server";
import { getCheckoutFieldsConfig } from "@/checkout/fields-server";
import { catalogCacheHeaders } from "@/lib/http-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await getCheckoutFieldsConfig();
  return NextResponse.json({ data: config }, { headers: catalogCacheHeaders(300, 600) });
}
