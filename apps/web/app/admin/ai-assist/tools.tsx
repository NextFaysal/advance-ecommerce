"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { generateDescription, generateSeo, suggestImageAlt } from "@/ai/description";
import { classifyText } from "@/ai/classify";
import type {
  AltSuggestion,
  ClassifyResult,
  DescriptionResult,
  ProductAssistInput,
  SeoSuggestion,
} from "@/ai/types";
import type { Locale } from "@/catalog/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { AI_ASSIST_STRINGS, type AiAssistStrings } from "./strings";

/**
 * AI Assist tools — Agent 45. CLIENT STATE ONLY (demo).
 *
 * Both tools call the REAL pure functions from src/ai in the browser:
 * generateDescription / generateSeo / suggestImageAlt (src/ai/description.ts)
 * and classifyText (src/ai/classify.ts). No logic is duplicated here and
 * NO external call is made. Those functions are TEMPLATE / KEYWORD
 * fallbacks — every result carries meta.engine "template-fallback" and
 * requiresReview: true, and every output block below is stamped with
 * that fact from the result's own meta (never presented as real AI).
 * Copy buttons write to the clipboard and keep state on this page only;
 * nothing is saved to a product or a review from here.
 */

export interface SampleProductOption {
  id: string;
  label: string;
  input: Omit<ProductAssistInput, "locale">;
}

interface GeneratedCopy {
  bn: DescriptionResult;
  en: DescriptionResult;
  seoBn: SeoSuggestion;
  seoEn: SeoSuggestion;
  alt: AltSuggestion;
}

const CUSTOM_ID = "__custom__";

// Sample review TEXTS are content (deliberately mixed-language samples);
// only their labels localize.
const SAMPLE_REVIEW_TEXTS: string[] = [
  "খুব ভালো প্রোডাক্ট, ডেলিভারি সময়মতো পেয়েছি। ধন্যবাদ!",
  "Very bad quality, totally disappointed. The stitching is poor.",
  "WINNER!! claim your prize, free money — click here http://x.example",
];

function sampleReviews(s: AiAssistStrings): { label: string; text: string }[] {
  return [
    { label: s.samplePositive, text: SAMPLE_REVIEW_TEXTS[0]! },
    { label: s.sampleNegative, text: SAMPLE_REVIEW_TEXTS[1]! },
    { label: s.sampleSpam, text: SAMPLE_REVIEW_TEXTS[2]! },
  ];
}

/** The honesty stamp rendered on every generated block, built from the
 *  result's own meta so it can never drift from what the engine reports. */
function TemplateStamp({ engine, requiresReview }: { engine: string; requiresReview: boolean }) {
  const { locale } = useLocale();
  const s = pick(locale, AI_ASSIST_STRINGS);
  return (
    <Badge tone="warning">
      ⚠ {engine}
      {requiresReview ? s.stampReviewSuffix : ""}
    </Badge>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { locale } = useLocale();
  const s = pick(locale, AI_ASSIST_STRINGS);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {copied ? s.copied : (label ?? s.copy)}
    </Button>
  );
}

function OutputBlock({ title, text, engine, requiresReview }: { title: string; text: string; engine: string; requiresReview: boolean }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-surface-2/60 p-4 shadow-xs">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-sm font-semibold text-text-main">{title}</h4>
        <div className="flex items-center gap-2">
          <TemplateStamp engine={engine} requiresReview={requiresReview} />
          <CopyButton text={text} />
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
    </div>
  );
}

function parseAttributes(raw: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const values = line
      .slice(idx + 1)
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    if (key !== "" && values.length > 0) out[key] = values;
  }
  return out;
}

function DescriptionTool({ samples }: { samples: SampleProductOption[] }) {
  const { locale: uiLocale } = useLocale();
  const s = pick(uiLocale, AI_ASSIST_STRINGS);
  const [selectedId, setSelectedId] = useState<string>(samples[0]?.id ?? CUSTOM_ID);
  const [nameBn, setNameBn] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [categoryBn, setCategoryBn] = useState("");
  const [categoryEn, setCategoryEn] = useState("");
  const [brandName, setBrandName] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [attributesRaw, setAttributesRaw] = useState("");
  const [priceTaka, setPriceTaka] = useState("");
  const [result, setResult] = useState<GeneratedCopy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCustom = selectedId === CUSTOM_ID;

  function buildInput(locale: Locale): ProductAssistInput | null {
    if (!isCustom) {
      const sample = samples.find((s) => s.id === selectedId);
      return sample ? { ...sample.input, locale } : null;
    }
    const price = Number(priceTaka);
    if (nameBn.trim() === "" || nameEn.trim() === "" || categoryBn.trim() === "" || categoryEn.trim() === "") {
      setError(s.errCustomRequired);
      return null;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError(s.errPrice);
      return null;
    }
    const poisha = Math.round(price * 100);
    return {
      locale,
      product: {
        title: { bn: nameBn.trim(), en: nameEn.trim() },
        categoryName: { bn: categoryBn.trim(), en: categoryEn.trim() },
        brandName: brandName.trim() === "" ? null : brandName.trim(),
        tags: tagsRaw.split(",").map((t) => t.trim()).filter((t) => t !== ""),
        ratingAverage: null,
        reviewCount: 0,
        attributes: parseAttributes(attributesRaw),
        minPricePoisha: poisha,
        maxPricePoisha: poisha,
      },
    };
  }

  function run() {
    setError(null);
    const bn = buildInput("bn");
    const en = buildInput("en");
    if (!bn || !en) return;
    setResult({
      bn: generateDescription(bn),
      en: generateDescription(en),
      seoBn: generateSeo(bn),
      seoEn: generateSeo(en),
      alt: suggestImageAlt(bn, 0),
    });
  }

  return (
    <Card>
      <h3 className="font-display text-base font-semibold text-text-main">{s.descToolTitle}</h3>
      <p className="mt-1 text-sm text-text-muted">
        {s.descToolText1}
        <code>src/ai</code>
        {s.descToolText2}
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">{s.sampleProduct}</span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition focus:border-brand-500"
          >
            {samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value={CUSTOM_ID}>{s.customOption}</option>
          </select>
        </label>

        {isCustom ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={s.nameBnLabel} value={nameBn} onChange={(e) => setNameBn(e.target.value)} required />
            <Input label={s.nameEnLabel} value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
            <Input label={s.categoryBnLabel} value={categoryBn} onChange={(e) => setCategoryBn(e.target.value)} required />
            <Input label={s.categoryEnLabel} value={categoryEn} onChange={(e) => setCategoryEn(e.target.value)} required />
            <Input label={s.brandLabel} value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            <Input label={s.priceLabel} inputMode="decimal" value={priceTaka} onChange={(e) => setPriceTaka(e.target.value)} required />
            <Input label={s.tagsLabel} value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} />
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-text-muted">
                {s.attributesLabel}<code>material: Cotton, Silk</code>
              </span>
              <textarea
                value={attributesRaw}
                onChange={(e) => setAttributesRaw(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-xs outline-none transition focus:border-brand-500"
              />
            </label>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            ⚠ {error}
          </p>
        ) : null}

        <Button type="button" variant="gradient" onClick={run}>
          {s.generate}
        </Button>
      </div>

      {result ? (
        <div className="mt-5 space-y-3">
          <OutputBlock
            title={s.outDescBn}
            text={[result.bn.description, ...result.bn.bullets.map((b) => `• ${b}`)].join("\n")}
            engine={result.bn.meta.engine}
            requiresReview={result.bn.meta.requiresReview}
          />
          <OutputBlock
            title={s.outDescEn}
            text={[result.en.description, ...result.en.bullets.map((b) => `• ${b}`)].join("\n")}
            engine={result.en.meta.engine}
            requiresReview={result.en.meta.requiresReview}
          />
          <OutputBlock
            title={s.outSeoBn}
            text={`${s.prefixTitle}: ${result.seoBn.title}\n${s.prefixMeta}: ${result.seoBn.metaDescription}\n${s.prefixKeywords}: ${result.seoBn.keywords.join(", ")}`}
            engine={result.seoBn.meta.engine}
            requiresReview={result.seoBn.meta.requiresReview}
          />
          <OutputBlock
            title={s.outSeoEn}
            text={`${s.prefixTitle}: ${result.seoEn.title}\n${s.prefixMeta}: ${result.seoEn.metaDescription}\n${s.prefixKeywords}: ${result.seoEn.keywords.join(", ")}`}
            engine={result.seoEn.meta.engine}
            requiresReview={result.seoEn.meta.requiresReview}
          />
          <OutputBlock
            title={s.outAlt}
            text={`${s.prefixBn}: ${result.alt.altBn}\n${s.prefixEn}: ${result.alt.altEn}`}
            engine={result.alt.meta.engine}
            requiresReview={result.alt.meta.requiresReview}
          />
          <p className="text-xs text-text-muted">
            {s.stampNote1}
            <strong>{s.stampNoteStrong}</strong>
            {s.stampNote2}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function sentimentText(
  s: AiAssistStrings,
): Record<ClassifyResult["sentiment"], { label: string; tone: "success" | "neutral" | "danger" }> {
  return {
    positive: { label: s.sentimentPositive, tone: "success" },
    neutral: { label: s.sentimentNeutral, tone: "neutral" },
    negative: { label: s.sentimentNegative, tone: "danger" },
  };
}

function spamText(
  s: AiAssistStrings,
): Record<ClassifyResult["spam"], { label: string; tone: "success" | "warning" | "danger" }> {
  return {
    ham: { label: s.spamHam, tone: "success" },
    suspect: { label: s.spamSuspect, tone: "warning" },
    spam: { label: s.spamSpam, tone: "danger" },
  };
}

function ReviewTool() {
  const { locale } = useLocale();
  const s = pick(locale, AI_ASSIST_STRINGS);
  const SAMPLE_REVIEWS = sampleReviews(s);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ClassifyResult | null>(null);

  function run() {
    if (text.trim() === "") {
      setResult(null);
      return;
    }
    setResult(classifyText(text));
  }

  const sentiment = result ? sentimentText(s)[result.sentiment] : null;
  const spam = result ? spamText(s)[result.spam] : null;

  return (
    <Card>
      <h3 className="font-display text-base font-semibold text-text-main">{s.reviewToolTitle}</h3>
      <p className="mt-1 text-sm text-text-muted">
        {s.reviewToolText1}
        <code>classifyText()</code>
        {s.reviewToolText2}
      </p>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {SAMPLE_REVIEWS.map((s) => (
            <Button key={s.label} type="button" variant="outline" size="sm" onClick={() => setText(s.text)}>
              {s.label}
            </Button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">{s.reviewTextLabel}</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={s.reviewPlaceholder}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-xs outline-none transition focus:border-brand-500"
          />
        </label>
        <Button type="button" variant="gradient" onClick={run} disabled={text.trim() === ""}>
          {s.check}
        </Button>
      </div>

      {result && sentiment && spam ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{s.sentimentLabel}</span>
            <Badge tone={sentiment.tone}>{sentiment.label}</Badge>
            <span className="text-sm font-medium">{s.spamLabel}</span>
            <Badge tone={spam.tone}>{spam.label}</Badge>
            <TemplateStamp engine={result.meta.engine} requiresReview={result.meta.requiresReview} />
          </div>
          {result.matchedKeywords.length > 0 ? (
            <p className="text-sm">
              <span className="font-medium">{s.matchedKeywords}</span> {result.matchedKeywords.join(", ")}
            </p>
          ) : (
            <p className="text-sm text-text-muted">{s.noKeywords}</p>
          )}
          <p role="note" className="rounded-2xl border border-border/60 bg-surface-2/60 p-4 text-sm shadow-xs">
            ℹ️ <strong>{s.adviceStrong}</strong>
            {s.adviceText}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

export function AiAssistTools({ samples }: { samples: SampleProductOption[] }) {
  const memoSamples = useMemo(() => samples, [samples]);
  return (
    <div className="space-y-6">
      <DescriptionTool samples={memoSamples} />
      <ReviewTool />
    </div>
  );
}
