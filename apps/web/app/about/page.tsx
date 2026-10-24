/**
 * /about — About Us. Agent 29.
 * PLACEHOLDER brand story in src/legal/content.ts — owner must replace.
 */
import type { Metadata } from "next";
import LegalPageView from "@/legal/LegalPageView";
import { ABOUT_CONTENT, DEFAULT_LEGAL_LOCALE } from "@/legal/content";

const content = ABOUT_CONTENT[DEFAULT_LEGAL_LOCALE];

export const metadata: Metadata = {
  title: `${content.title} — Advance Ecommerce`,
  description: content.description,
};

export default function AboutPage() {
  return <LegalPageView content={content} />;
}
