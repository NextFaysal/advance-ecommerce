/**
 * /terms — Terms & Conditions. Agent 29.
 * Content lives in src/legal/content.ts (DRAFT template, bn default).
 */
import type { Metadata } from "next";
import LegalPageView from "@/legal/LegalPageView";
import { DEFAULT_LEGAL_LOCALE, TERMS_CONTENT } from "@/legal/content";

const content = TERMS_CONTENT[DEFAULT_LEGAL_LOCALE];

export const metadata: Metadata = {
  title: `${content.title} — Advance Ecommerce`,
  description: content.description,
};

export default function TermsPage() {
  return <LegalPageView content={content} />;
}
