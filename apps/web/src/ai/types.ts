/**
 * AI assist contracts — Agent 15, Step 47 (A3).
 *
 * HONESTY CONTRACT: there is NO real LLM / ML model in this codebase today.
 * Every generator in src/ai is a deterministic TEMPLATE / RULE fallback:
 * it assembles usable text from product attributes and keyword tables.
 * Results always carry `engine: "template-fallback"` so the admin UI can
 * label them ("Template suggestion — review before publishing") and never
 * present them as model output.
 *
 * Real provider integration (later, behind Admin > Settings):
 *  - Implement `AiProvider` against a real provider (key stored ENCRYPTED
 *    in the settings table, server-side only — see src/lib/settings.ts).
 *  - Swap the provider in the API routes; the request/response types in
 *    this file do not change, and `engine` becomes "provider".
 *  - The template fallback stays as the offline failure mode.
 */
import type { Locale, Product } from "../catalog/types";

export type AiEngine = "template-fallback" | "provider";

export interface AiGenerationMeta {
  engine: AiEngine;
  /** Human label the UI must show next to generated text. */
  label: string;
  /** True when a human should review before this reaches customers. */
  requiresReview: boolean;
}

export const TEMPLATE_META: AiGenerationMeta = {
  engine: "template-fallback",
  label: "Template suggestion (no AI model) — review before publishing",
  requiresReview: true,
};

/** Feature-flag keys (FeatureFlag table). Rows are seeded by the DB owner;
 *  until a row exists and is enabled, the API routes fail closed. */
export const AI_FEATURE_FLAG = "module.ai_assist";
export const ANALYTICS_FEATURE_FLAG = "module.advanced_analytics";

export interface ProductAssistInput {
  product: Pick<
    Product,
    "title" | "categoryName" | "brandName" | "tags" | "ratingAverage" | "reviewCount"
  > & {
    /** Attribute key -> chosen values, e.g. { color: ["লাল"], material: ["Cotton"] } */
    attributes: Record<string, string[]>;
    /** Price band for copy, integer poisha. */
    minPricePoisha: number;
    maxPricePoisha: number;
  };
  locale: Locale;
}

export interface DescriptionResult {
  description: string;
  bullets: string[];
  meta: AiGenerationMeta;
}

export interface SeoSuggestion {
  title: string;
  metaDescription: string;
  keywords: string[];
  meta: AiGenerationMeta;
}

export interface AltSuggestion {
  altBn: string;
  altEn: string;
  meta: AiGenerationMeta;
}

/** The seam a real provider implements later. Not implemented today. */
export interface AiProvider {
  readonly engine: "provider";
  generateDescription(input: ProductAssistInput): Promise<DescriptionResult>;
  generateSeo(input: ProductAssistInput): Promise<SeoSuggestion>;
  classifyText(text: string): Promise<ClassifyResult>;
}

export type Sentiment = "positive" | "neutral" | "negative";
export type SpamVerdict = "ham" | "suspect" | "spam";

export interface ClassifyResult {
  sentiment: Sentiment;
  spam: SpamVerdict;
  /** Keyword hits that decided the verdict — shown to staff, never hidden. */
  matchedKeywords: string[];
  meta: AiGenerationMeta;
}
