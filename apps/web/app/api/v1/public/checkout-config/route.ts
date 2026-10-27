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
 * smuggle a value past the rules. NOT cached: an admin edit should
 * reach the next checkout page load. Reads are fail-soft — a
 * missing/corrupt doc resolves to the default config, which is the
 * original hardcoded form.
 */
import { NextResponse } from "next/server";
import { getCheckoutFieldsConfig } from "@/checkout/fields-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await getCheckoutFieldsConfig();
  return NextResponse.json({ data: config });
}
