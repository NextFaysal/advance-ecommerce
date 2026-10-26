/**
 * AI Provider Live Adapter — OpenAI / LLM-compatible client.
 *
 * Implements the `AiProvider` contract (src/ai/types.ts):
 * - Key resolution: AI_API_KEY / OPENAI_API_KEY env or Admin Setting `ai.api_key`
 * - When configured: sends structured prompts to LLM with JSON format
 * - When offline/unconfigured: fails open to deterministic template fallback
 *   so the admin experience is never blocked.
 */
import type {
  AiProvider,
  ClassifyResult,
  DescriptionResult,
  ProductAssistInput,
  SeoSuggestion,
} from "./types";
import { generateDescription as templateDescription, generateSeo as templateSeo } from "./description";
import { classifyText as templateClassify } from "./classify";
import { getSetting } from "../lib/settings";

export interface AiProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class LiveAiProvider implements AiProvider {
  readonly engine = "provider" as const;
  private config: AiProviderConfig;

  constructor(config: AiProviderConfig = {}) {
    this.config = {
      apiKey: config.apiKey || process.env.AI_API_KEY || process.env.OPENAI_API_KEY,
      baseUrl: config.baseUrl || process.env.AI_BASE_URL || "https://api.openai.com/v1",
      model: config.model || process.env.AI_MODEL || "gpt-4o-mini",
    };
  }

  private async getResolvedApiKey(): Promise<string | undefined> {
    if (this.config.apiKey) return this.config.apiKey;
    try {
      const dbKey = await getSetting("ai.api_key");
      if (dbKey) return dbKey;
    } catch {
      // Database not available or key unconfigured
    }
    return process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  }

  private async callLlm(systemPrompt: string, userPrompt: string): Promise<string | null> {
    const key = await this.getResolvedApiKey();
    if (!key) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.7,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        console.warn(`[AI Provider] HTTP ${res.status}: ${await res.text().catch(() => "")}`);
        return null;
      }

      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? null;
    } catch (e) {
      console.warn("[AI Provider] Generation error, falling back to templates:", e);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateDescription(input: ProductAssistInput): Promise<DescriptionResult> {
    const lang = input.locale === "bn" ? "Bengali (বাংলা)" : "English";
    const systemPrompt = `You are an expert eCommerce copywriter for Bangladesh online shopping. Return JSON with keys: "description" (engaging marketing description formatted in clean HTML paragraphs) and "bullets" (array of 4-6 selling points in ${lang}).`;
    const userPrompt = `Product: ${JSON.stringify(input.product)}\nTarget Language: ${lang}`;

    const raw = await this.callLlm(systemPrompt, userPrompt);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { description?: string; bullets?: string[] };
        if (parsed.description && Array.isArray(parsed.bullets)) {
          return {
            description: parsed.description,
            bullets: parsed.bullets,
            meta: {
              engine: "provider",
              label: `AI Generated (${this.config.model})`,
              requiresReview: true,
            },
          };
        }
      } catch {
        // Fall back
      }
    }

    return templateDescription(input);
  }

  async generateSeo(input: ProductAssistInput): Promise<SeoSuggestion> {
    const lang = input.locale === "bn" ? "Bengali" : "English";
    const systemPrompt = `You are an SEO specialist for eCommerce. Return JSON with keys: "title" (under 60 chars), "metaDescription" (under 160 chars), and "keywords" (array of 6-10 keywords in ${lang}).`;
    const userPrompt = `Product: ${JSON.stringify(input.product)}\nLanguage: ${lang}`;

    const raw = await this.callLlm(systemPrompt, userPrompt);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          title?: string;
          metaDescription?: string;
          keywords?: string[];
        };
        if (parsed.title && parsed.metaDescription && Array.isArray(parsed.keywords)) {
          return {
            title: parsed.title,
            metaDescription: parsed.metaDescription,
            keywords: parsed.keywords,
            meta: {
              engine: "provider",
              label: `AI Generated (${this.config.model})`,
              requiresReview: true,
            },
          };
        }
      } catch {
        // Fall back
      }
    }

    return templateSeo(input);
  }

  async classifyText(text: string): Promise<ClassifyResult> {
    const systemPrompt = `You are a sentiment and spam analysis agent for Bengali and English eCommerce customer feedback. Return JSON with keys: "sentiment" ("positive" | "neutral" | "negative"), "spam" ("ham" | "suspect" | "spam"), and "matchedKeywords" (array of detected trigger words).`;
    const userPrompt = `Review text: ${text}`;

    const raw = await this.callLlm(systemPrompt, userPrompt);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          sentiment?: "positive" | "neutral" | "negative";
          spam?: "ham" | "suspect" | "spam";
          matchedKeywords?: string[];
        };
        if (parsed.sentiment && parsed.spam) {
          return {
            sentiment: parsed.sentiment,
            spam: parsed.spam,
            matchedKeywords: parsed.matchedKeywords || [],
            meta: {
              engine: "provider",
              label: `AI Classified (${this.config.model})`,
              requiresReview: false,
            },
          };
        }
      } catch {
        // Fall back
      }
    }

    return templateClassify(text);
  }
}

/** Singleton instance used across admin AI routes */
export const aiProvider: AiProvider = new LiveAiProvider();
