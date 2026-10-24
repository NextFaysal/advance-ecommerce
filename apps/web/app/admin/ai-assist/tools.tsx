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

const SAMPLE_REVIEWS: { label: string; text: string }[] = [
  { label: "নমুনা: ইতিবাচক (বাংলা)", text: "খুব ভালো প্রোডাক্ট, ডেলিভারি সময়মতো পেয়েছি। ধন্যবাদ!" },
  { label: "নমুনা: নেতিবাচক (English)", text: "Very bad quality, totally disappointed. The stitching is poor." },
  { label: "নমুনা: স্প্যাম (English)", text: "WINNER!! claim your prize, free money — click here http://x.example" },
];

/** The honesty stamp rendered on every generated block, built from the
 *  result's own meta so it can never drift from what the engine reports. */
function TemplateStamp({ engine, requiresReview }: { engine: string; requiresReview: boolean }) {
  return (
    <Badge tone="warning">
      ⚠ {engine}
      {requiresReview ? " — মানুষের রিভিউ লাগবে" : ""}
    </Badge>
  );
}

function CopyButton({ text, label = "কপি করুন" }: { text: string; label?: string }) {
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
      {copied ? "✓ কপি হয়েছে" : label}
    </Button>
  );
}

function OutputBlock({ title, text, engine, requiresReview }: { title: string; text: string; engine: string; requiresReview: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
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
      setError("কাস্টম পণ্যের নাম (বাংলা ও English) এবং ক্যাটাগরি (বাংলা ও English) আবশ্যক।");
      return null;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError("দাম টাকায় লিখুন (০ বা তার বেশি)।");
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
    <Card className="p-4">
      <h3 className="text-base font-semibold">পণ্যের বর্ণনা তৈরি (টেমপ্লেট)</h3>
      <p className="mt-1 text-sm text-text-muted">
        নমুনা পণ্য বেছে নিন অথবা নিজে নাম/ক্যাটাগরি/বৈশিষ্ট্য লিখুন — আউটপুট আসল{" "}
        <code>src/ai</code> জেনারেটর থেকেই আসে (টেমপ্লেট-ভিত্তিক, কোনো AI মডেল নয়)।
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">নমুনা পণ্য</span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
          >
            {samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value={CUSTOM_ID}>✎ নিজে লিখুন (কাস্টম)</option>
          </select>
        </label>

        {isCustom ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="পণ্যের নাম (বাংলা)" value={nameBn} onChange={(e) => setNameBn(e.target.value)} required />
            <Input label="Product name (English)" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
            <Input label="ক্যাটাগরি (বাংলা)" value={categoryBn} onChange={(e) => setCategoryBn(e.target.value)} required />
            <Input label="Category (English)" value={categoryEn} onChange={(e) => setCategoryEn(e.target.value)} required />
            <Input label="ব্র্যান্ড (ঐচ্ছিক)" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            <Input label="দাম (টাকা)" inputMode="decimal" value={priceTaka} onChange={(e) => setPriceTaka(e.target.value)} required />
            <Input label="ট্যাগ (কমা দিয়ে, ঐচ্ছিক)" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} />
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-text-muted">
                বৈশিষ্ট্য — প্রতি লাইনে একটি: <code>material: Cotton, Silk</code>
              </span>
              <textarea
                value={attributesRaw}
                onChange={(e) => setAttributesRaw(e.target.value)}
                rows={3}
                className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-rose-500">
            ⚠ {error}
          </p>
        ) : null}

        <Button type="button" variant="gradient" onClick={run}>
          খসড়া তৈরি করুন
        </Button>
      </div>

      {result ? (
        <div className="mt-5 space-y-3">
          <OutputBlock
            title="বর্ণনা (বাংলা)"
            text={[result.bn.description, ...result.bn.bullets.map((b) => `• ${b}`)].join("\n")}
            engine={result.bn.meta.engine}
            requiresReview={result.bn.meta.requiresReview}
          />
          <OutputBlock
            title="Description (English)"
            text={[result.en.description, ...result.en.bullets.map((b) => `• ${b}`)].join("\n")}
            engine={result.en.meta.engine}
            requiresReview={result.en.meta.requiresReview}
          />
          <OutputBlock
            title="SEO শিরোনাম ও মেটা (বাংলা)"
            text={`শিরোনাম: ${result.seoBn.title}\nমেটা বর্ণনা: ${result.seoBn.metaDescription}\nকীওয়ার্ড: ${result.seoBn.keywords.join(", ")}`}
            engine={result.seoBn.meta.engine}
            requiresReview={result.seoBn.meta.requiresReview}
          />
          <OutputBlock
            title="SEO title & meta (English)"
            text={`Title: ${result.seoEn.title}\nMeta description: ${result.seoEn.metaDescription}\nKeywords: ${result.seoEn.keywords.join(", ")}`}
            engine={result.seoEn.meta.engine}
            requiresReview={result.seoEn.meta.requiresReview}
          />
          <OutputBlock
            title="ছবির Alt text"
            text={`বাংলা: ${result.alt.altBn}\nEnglish: ${result.alt.altEn}`}
            engine={result.alt.meta.engine}
            requiresReview={result.alt.meta.requiresReview}
          />
          <p className="text-xs text-text-muted">
            প্রতিটি আউটপুটেই <strong>template-fallback — মানুষের রিভিউ লাগবে</strong> স্ট্যাম্প আছে: এগুলো টেমপ্লেট থেকে
            সাজানো খসড়া, প্রকাশের আগে অবশ্যই মানুষের যাচাই লাগবে। কপি করা পর্যন্তই এই পেজের কাজ — কিছুই পণ্যে সেভ হয় না।
          </p>
        </div>
      ) : null}
    </Card>
  );
}

const SENTIMENT_TEXT: Record<ClassifyResult["sentiment"], { label: string; tone: "success" | "neutral" | "danger" }> = {
  positive: { label: "ইতিবাচক (positive)", tone: "success" },
  neutral: { label: "নিরপেক্ষ (neutral)", tone: "neutral" },
  negative: { label: "নেতিবাচক (negative)", tone: "danger" },
};

const SPAM_TEXT: Record<ClassifyResult["spam"], { label: string; tone: "success" | "warning" | "danger" }> = {
  ham: { label: "স্বাভাবিক (ham)", tone: "success" },
  suspect: { label: "সন্দেহজনক (suspect)", tone: "warning" },
  spam: { label: "স্প্যাম (spam)", tone: "danger" },
};

function ReviewTool() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ClassifyResult | null>(null);

  function run() {
    if (text.trim() === "") {
      setResult(null);
      return;
    }
    setResult(classifyText(text));
  }

  const sentiment = result ? SENTIMENT_TEXT[result.sentiment] : null;
  const spam = result ? SPAM_TEXT[result.spam] : null;

  return (
    <Card className="p-4">
      <h3 className="text-base font-semibold">রিভিউ সহায়ক (কিওয়ার্ড শ্রেণিবিন্যাস)</h3>
      <p className="mt-1 text-sm text-text-muted">
        একটি নমুনা রিভিউ লিখুন বা পেস্ট করুন — আসল <code>classifyText()</code> কিওয়ার্ড তালিকা দিয়ে অনুভূতি ও স্প্যাম
        সন্দেহ যাচাই করবে। এটি ML নয়; ব্যঙ্গ বা মিশ্র ভাষা ধরতে নাও পারে।
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
          <span className="mb-1 block text-xs font-medium text-text-muted">রিভিউ লেখা</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="যেমন: খুব ভালো প্রোডাক্ট, ধন্যবাদ"
            className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <Button type="button" variant="gradient" onClick={run} disabled={text.trim() === ""}>
          যাচাই করুন
        </Button>
      </div>

      {result && sentiment && spam ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">অনুভূতি:</span>
            <Badge tone={sentiment.tone}>{sentiment.label}</Badge>
            <span className="text-sm font-medium">স্প্যাম রায়:</span>
            <Badge tone={spam.tone}>{spam.label}</Badge>
            <TemplateStamp engine={result.meta.engine} requiresReview={result.meta.requiresReview} />
          </div>
          {result.matchedKeywords.length > 0 ? (
            <p className="text-sm">
              <span className="font-medium">যে কিওয়ার্ড মিলেছে:</span> {result.matchedKeywords.join(", ")}
            </p>
          ) : (
            <p className="text-sm text-text-muted">কোনো কিওয়ার্ড মেলেনি — তাই নিরপেক্ষ/স্বাভাবিক রায় এসেছে।</p>
          )}
          <p role="note" className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
            ℹ️ <strong>শুধু পরামর্শ:</strong> এই রায় দেখে রিভিউ কখনোই অটো-ডিলিট হয় না। স্প্যাম রায় এলেও চূড়ান্ত
            সিদ্ধান্ত মানুষের — স্টাফ কিওয়ার্ডগুলো দেখে নিজে সিদ্ধান্ত নেবেন।
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
