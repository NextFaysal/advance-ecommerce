/**
 * /shipping-policy — Shipping Policy. Agent 29.
 * Charges come from SHIPPING_ZONE_CONFIG in src/legal/content.ts (seed
 * zones), never hardcoded per page. DRAFT template, full {bn, en}.
 * Locale resolves per request (doc 30): visitor cookie → store default.
 */
import type { Metadata } from "next";
import LegalPageView from "@/legal/LegalPageView";
import { SHIPPING_POLICY_CONTENT } from "@/legal/content";
import { getRequestLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const content = SHIPPING_POLICY_CONTENT[locale];
  return {
    title: `${content.title} — Advance Ecommerce`,
    description: content.description,
  };
}

export default async function ShippingPolicyPage() {
  const locale = await getRequestLocale();
  return <LegalPageView content={SHIPPING_POLICY_CONTENT[locale]} locale={locale} />;
}
