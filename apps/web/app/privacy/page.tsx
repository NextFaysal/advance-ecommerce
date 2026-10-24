/**
 * /privacy — Privacy Policy. Agent 29.
 * Content lives in src/legal/content.ts (DRAFT template, bn default).
 */
import type { Metadata } from "next";
import LegalPageView from "@/legal/LegalPageView";
import { DEFAULT_LEGAL_LOCALE, PRIVACY_CONTENT } from "@/legal/content";

const content = PRIVACY_CONTENT[DEFAULT_LEGAL_LOCALE];

export const metadata: Metadata = {
  title: `${content.title} — Advance Ecommerce`,
  description: content.description,
};

export default function PrivacyPage() {
  return <LegalPageView content={content} />;
}
