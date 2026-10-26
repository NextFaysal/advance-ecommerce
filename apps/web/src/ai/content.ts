/**
 * AI content generation — doc 23 wave 57 part A (ADV-24), flag
 * `module.ai_content`. Bilingual product-description + SEO drafts for
 * the admin product editor, built on the owner's provider
 * (src/ai/provider.ts — OpenAI-compatible chat completions, JSON mode).
 *
 * HONESTY CONTRACT (platform rule: never present template-fallback
 * output as a real result):
 * - The AiProvider contract in src/ai/types.ts defines NO
 *   NOT_CONFIGURED error — when no key resolves, LiveAiProvider
 *   silently returns deterministic template text with
 *   meta.engine "template-fallback". These generators therefore probe
 *   `aiProvider.isConfigured()` first (the provider's own key
 *   resolution: env AI_API_KEY / OPENAI_API_KEY, else the Admin
 *   Setting `ai.api_key`) and throw AI_NOT_CONFIGURED instead of ever
 *   serving template text from an "AI" button.
 * - A configured provider whose call fails / times out / returns
 *   unparseable output → AI_PROVIDER_ERROR / AI_INVALID_RESPONSE.
 *   Nothing is fabricated locally to fill the gap.
 * - Output is a DRAFT, always: the admin routes return it, the editor
 *   fills ordinary form fields, and a human reviews + saves through
 *   the normal product save path. Nothing here persists anything.
 *
 * ANTI-FABRICATION: the prompts below instruct the model to use ONLY
 * the facts supplied in the input (name / category / brand /
 * attributes / keywords) — no invented specifications, materials,
 * certifications, discounts, prices, ratings or warranty claims — and
 * every field is length-bounded again on the way out.
 */
import { aiProvider } from "./provider";

export const AI_CONTENT_FLAG = "module.ai_content";

export interface AiContentInput {
  productName: string;
  /** English product name when known (editor title / stored product). */
  productNameEn?: string;
  categoryName?: string;
  brandName?: string;
  /** Attribute key -> chosen values, e.g. { color: ["লাল"] }. */
  attributes?: Record<string, string[]>;
  keywords?: string[];
  /** Free-text tone hint, e.g. "friendly" / "বন্ধুসুলভ". Optional. */
  tone?: string;
}

export interface ProductContentDraft {
  bn: string;
  en: string;
  seoTitleBn: string;
  seoTitleEn: string;
  seoDescriptionBn: string;
  seoDescriptionEn: string;
}

export type ProductSeoDraft = Pick<
  ProductContentDraft,
  "seoTitleBn" | "seoTitleEn" | "seoDescriptionBn" | "seoDescriptionEn"
>;

export type AiContentErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_PROVIDER_ERROR"
  | "AI_INVALID_RESPONSE";

export class AiContentError extends Error {
  readonly code: AiContentErrorCode;
  /** HTTP status the route answers: 503 unconfigured (the house
   *  NOT_CONFIGURED pattern, cf. STORAGE_NOT_CONFIGURED), 502 when a
   *  configured provider failed or answered unusably. */
  readonly status: number;

  constructor(code: AiContentErrorCode, message: string) {
    super(message);
    this.name = "AiContentError";
    this.code = code;
    this.status = code === "AI_NOT_CONFIGURED" ? 503 : 502;
  }
}

const NOT_CONFIGURED_MESSAGE =
  "AI provider is not configured. Set AI_API_KEY (or OPENAI_API_KEY) in the server environment, or the ai.api_key Admin Setting, then try again. Nothing was generated.";

const FACT_RULES = [
  "Use ONLY the facts given in the input JSON. Never invent specifications, materials, sizes, certifications, discounts, prices, ratings, reviews, or warranty claims that are not in the input.",
  "Write natural, honest marketing copy. If the input is sparse, keep the copy general instead of inventing details.",
  "Output plain text only: no HTML, no markdown, no headings. Paragraphs separated by a blank line.",
].join(" ");

function clampText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trim() : trimmed;
}

async function runGeneration(
  systemPrompt: string,
  input: AiContentInput,
): Promise<Record<string, unknown>> {
  if (!(await aiProvider.isConfigured())) {
    throw new AiContentError("AI_NOT_CONFIGURED", NOT_CONFIGURED_MESSAGE);
  }
  const raw = await aiProvider.generateJson(systemPrompt, JSON.stringify(input));
  if (!raw) {
    throw new AiContentError(
      "AI_PROVIDER_ERROR",
      "The AI provider call failed or timed out. Nothing was generated — please try again.",
    );
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new AiContentError(
      "AI_INVALID_RESPONSE",
      "The AI provider returned an unusable response. Nothing was generated — please try again.",
    );
  }
}

function pickFields(
  parsed: Record<string, unknown>,
  bounds: Record<string, number>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, max] of Object.entries(bounds)) {
    const value = parsed[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new AiContentError(
        "AI_INVALID_RESPONSE",
        `The AI provider response was missing the "${field}" field. Nothing was generated — please try again.`,
      );
    }
    out[field] = clampText(value, max);
  }
  return out;
}

const DESCRIPTION_BOUNDS: Record<string, number> = {
  bn: 2000,
  en: 2000,
  seoTitleBn: 70,
  seoTitleEn: 70,
  seoDescriptionBn: 170,
  seoDescriptionEn: 170,
};

const SEO_BOUNDS: Record<string, number> = {
  seoTitleBn: 70,
  seoTitleEn: 70,
  seoDescriptionBn: 170,
  seoDescriptionEn: 170,
};

/**
 * Full bilingual draft: Bangla + English descriptions AND SEO title /
 * meta description pairs, from ONE provider call. Throws
 * AiContentError (503 AI_NOT_CONFIGURED / 502 provider failures).
 */
export async function generateProductDescription(
  input: AiContentInput,
): Promise<ProductContentDraft> {
  const systemPrompt = [
    "You are an expert bilingual eCommerce copywriter for online shopping in Bangladesh.",
    FACT_RULES,
    'Return ONLY a JSON object with keys: "bn" (product description in natural Bangla / বাংলা), "en" (the same description in natural English), "seoTitleBn", "seoTitleEn", "seoDescriptionBn", "seoDescriptionEn".',
    "Descriptions: 2 short paragraphs each, at most 900 characters. SEO titles: at most 60 characters. SEO descriptions: at most 160 characters, written to earn a click honestly.",
    input.tone ? `Tone: ${input.tone}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const parsed = await runGeneration(systemPrompt, input);
  const draft = pickFields(parsed, DESCRIPTION_BOUNDS);
  return draft as unknown as ProductContentDraft;
}

/** SEO-only draft (titles + meta descriptions, bn + en). */
export async function generateProductSeo(
  input: AiContentInput,
): Promise<ProductSeoDraft> {
  const systemPrompt = [
    "You are an SEO specialist for eCommerce product pages in Bangladesh.",
    FACT_RULES,
    'Return ONLY a JSON object with keys: "seoTitleBn", "seoTitleEn", "seoDescriptionBn", "seoDescriptionEn".',
    "Titles: at most 60 characters, product name first. Descriptions: at most 160 characters. Weave the provided keywords in naturally when present — no keyword stuffing, no clickbait claims the input does not support.",
    input.tone ? `Tone: ${input.tone}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const parsed = await runGeneration(systemPrompt, input);
  const draft = pickFields(parsed, SEO_BOUNDS);
  return draft as unknown as ProductSeoDraft;
}
