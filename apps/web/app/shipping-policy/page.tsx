/**
 * /shipping-policy — Shipping Policy. Agent 29.
 * Charges come from SHIPPING_ZONE_CONFIG in src/legal/content.ts (seed
 * zones), never hardcoded per page. DRAFT template, bn default.
 */
import type { Metadata } from "next";
import LegalPageView from "@/legal/LegalPageView";
import { DEFAULT_LEGAL_LOCALE, SHIPPING_POLICY_CONTENT } from "@/legal/content";

const content = SHIPPING_POLICY_CONTENT[DEFAULT_LEGAL_LOCALE];

export const metadata: Metadata = {
  title: `${content.title} — Advance Ecommerce`,
  description: content.description,
};

export default function ShippingPolicyPage() {
  return <LegalPageView content={content} />;
}
