/**
 * /refund-policy — Return & Refund Policy. Agent 29.
 * Aligned with the order state machine (DELIVERED -> RETURN_REQUESTED ->
 * RETURNING -> RETURNED -> REFUNDED | EXCHANGED).
 * Content lives in src/legal/content.ts (DRAFT template, bn default).
 */
import type { Metadata } from "next";
import LegalPageView from "@/legal/LegalPageView";
import { DEFAULT_LEGAL_LOCALE, REFUND_POLICY_CONTENT } from "@/legal/content";

const content = REFUND_POLICY_CONTENT[DEFAULT_LEGAL_LOCALE];

export const metadata: Metadata = {
  title: `${content.title} — Advance Ecommerce`,
  description: content.description,
};

export default function RefundPolicyPage() {
  return <LegalPageView content={content} />;
}
