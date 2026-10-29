/**
 * /refund-policy — Return & Refund Policy. Agent 29.
 * Aligned with the order state machine (DELIVERED -> RETURN_REQUESTED ->
 * RETURNING -> RETURNED -> REFUNDED | EXCHANGED).
 * Content lives in src/legal/content.ts (DRAFT template, full {bn, en}).
 * Locale resolves per request (doc 30): visitor cookie → store default.
 */
import type { Metadata } from "next";
import LegalPageView from "@/legal/LegalPageView";
import { REFUND_POLICY_CONTENT } from "@/legal/content";
import { getStoreDefaultLocale } from "@/i18n/server";

// Speed fix (2026-10-29): ISR + force-static, the same pin the
// homepage and PDP carry. Content is editorial constants from
// @/legal/content; revalidate 300 matches the blog/CMS cadence.
export const revalidate = 300;
export const dynamic = "force-static";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getStoreDefaultLocale();
  const content = REFUND_POLICY_CONTENT[locale];
  return {
    title: `${content.title} — Advance Ecommerce`,
    description: content.description,
  };
}

export default async function RefundPolicyPage() {
  const locale = await getStoreDefaultLocale();
  return <LegalPageView content={REFUND_POLICY_CONTENT[locale]} locale={locale} />;
}
