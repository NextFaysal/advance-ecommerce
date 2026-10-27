/**
 * /about — About Us. Agent 29.
 * PLACEHOLDER brand story in src/legal/content.ts — owner must replace.
 * Locale resolves per request (doc 30): visitor cookie → store default.
 */
import type { Metadata } from "next";
import LegalPageView from "@/legal/LegalPageView";
import { ABOUT_CONTENT } from "@/legal/content";
import { getRequestLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const content = ABOUT_CONTENT[locale];
  return {
    title: `${content.title} — Advance Ecommerce`,
    description: content.description,
  };
}

export default async function AboutPage() {
  const locale = await getRequestLocale();
  return <LegalPageView content={ABOUT_CONTENT[locale]} locale={locale} />;
}
