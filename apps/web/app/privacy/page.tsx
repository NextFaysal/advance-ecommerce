/**
 * /privacy — Privacy Policy. Agent 29.
 * Content lives in src/legal/content.ts (DRAFT template, full {bn, en}).
 * Locale resolves per request (doc 30): visitor cookie → store default.
 */
import type { Metadata } from "next";
import LegalPageView from "@/legal/LegalPageView";
import { PRIVACY_CONTENT } from "@/legal/content";
import { getRequestLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const content = PRIVACY_CONTENT[locale];
  return {
    title: `${content.title} — Advance Ecommerce`,
    description: content.description,
  };
}

export default async function PrivacyPage() {
  const locale = await getRequestLocale();
  return <LegalPageView content={PRIVACY_CONTENT[locale]} locale={locale} />;
}
