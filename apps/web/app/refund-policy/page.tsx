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
import { getRequestLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const content = REFUND_POLICY_CONTENT[locale];
  return {
    title: `${content.title} — Advance Ecommerce`,
    description: content.description,
  };
}

export default async function RefundPolicyPage() {
  const locale = await getRequestLocale();
  return <LegalPageView content={REFUND_POLICY_CONTENT[locale]} locale={locale} />;
}
