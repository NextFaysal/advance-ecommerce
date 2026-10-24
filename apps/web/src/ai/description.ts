/**
 * Product copy generators — Agent 15, Step 47 (A3).
 * TEMPLATE FALLBACK ONLY: sentences are assembled from fixed bn/en
 * templates + the product's own attributes/tags/price band. Nothing here
 * "understands" the product; unusual attribute values are inserted
 * verbatim, which is why every result is flagged requiresReview.
 *
 * Test cases:
 *  input: title bn "জামদানি শাড়ি", category "শাড়ি", attrs {material:["Cotton"]},
 *         price 450000 poisha, locale "bn"
 *   -> description contains "জামদানি শাড়ি" and "Cotton" and "৳4,500",
 *      meta.engine === "template-fallback"
 *  locale "en" -> English template, title.en used, "BDT 4,500".
 *  No attributes -> attribute sentence is omitted (nothing invented).
 */
import { formatBdt } from "@advance-ecommerce/validators";
import type { AltSuggestion, DescriptionResult, ProductAssistInput, SeoSuggestion } from "./types";
import { TEMPLATE_META } from "./types";

function attrPhrase(input: ProductAssistInput): { bn: string; en: string } {
  const parts = Object.entries(input.product.attributes)
    .filter(([, values]) => values.length > 0)
    .map(([key, values]) => ({ key, text: values.join(", ") }));
  return {
    bn: parts.map((p) => `${p.key}: ${p.text}`).join("। "),
    en: parts.map((p) => `${p.key}: ${p.text}`).join(", "),
  };
}

function priceText(input: ProductAssistInput): { bn: string; en: string } {
  const min = formatBdt(input.product.minPricePoisha);
  if (input.product.maxPricePoisha > input.product.minPricePoisha) {
    const range = `${min} – ${formatBdt(input.product.maxPricePoisha)}`;
    return { bn: range, en: range };
  }
  return { bn: min, en: min };
}

export function generateDescription(input: ProductAssistInput): DescriptionResult {
  const p = input.product;
  const attrs = attrPhrase(input);
  const price = priceText(input);
  const rating =
    p.ratingAverage !== null && p.reviewCount > 0 ? { avg: p.ratingAverage.toFixed(1), count: p.reviewCount } : null;

  if (input.locale === "bn") {
    const lines = [
      `${p.title.bn} — ${p.categoryName.bn} ক্যাটাগরির একটি পণ্য${p.brandName ? `, ব্র্যান্ড: ${p.brandName}` : ""}।`,
      attrs.bn ? `বৈশিষ্ট্য: ${attrs.bn}।` : "",
      `দাম: ${price.bn}। অর্ডার করতে ক্যাশ অন ডেলিভারি সুবিধা রয়েছে।`,
      rating ? `কাস্টমার রেটিং: ${rating.avg}/৫ (${rating.count}টি রিভিউ)।` : "",
    ].filter((s) => s !== "");
    return {
      description: lines.join(" "),
      bullets: [
        ...(attrs.bn ? [`বৈশিষ্ট্য: ${attrs.bn}`] : []),
        `দাম: ${price.bn}`,
        "ক্যাশ অন ডেলিভারি",
        ...(rating ? [`রেটিং: ${rating.avg}/৫`] : []),
      ],
      meta: TEMPLATE_META,
    };
  }
  const lines = [
    `${p.title.en} — a product in the ${p.categoryName.en} category${p.brandName ? ` by ${p.brandName}` : ""}.`,
    attrs.en ? `Features: ${attrs.en}.` : "",
    `Price: ${price.en}. Cash on delivery available across Bangladesh.`,
    rating ? `Customer rating: ${rating.avg}/5 (${rating.count} reviews).` : "",
  ].filter((s) => s !== "");
  return {
    description: lines.join(" "),
    bullets: [
      ...(attrs.en ? [`Features: ${attrs.en}`] : []),
      `Price: ${price.en}`,
      "Cash on delivery",
      ...(rating ? [`Rating: ${rating.avg}/5`] : []),
    ],
    meta: TEMPLATE_META,
  };
}

export function generateSeo(input: ProductAssistInput): SeoSuggestion {
  const p = input.product;
  const price = priceText(input);
  const isBn = input.locale === "bn";
  const title = isBn
    ? `${p.title.bn} | দাম ${price.bn} | বাংলাদেশে কিনুন`
    : `${p.title.en} | Price ${price.en} in Bangladesh`;
  const metaDescription = isBn
    ? `${p.title.bn} কিনুন সেরা দামে (${price.bn})। ক্যাশ অন ডেলিভারি সহ সারাদেশে হোম ডেলিভারি।`
    : `Buy ${p.title.en} at the best price (${price.en}) in Bangladesh. Home delivery with cash on delivery.`;
  const keywords = Array.from(
    new Set([
      isBn ? p.title.bn : p.title.en,
      isBn ? p.categoryName.bn : p.categoryName.en,
      ...(p.brandName ? [p.brandName] : []),
      ...p.tags,
    ].map((k) => k.trim()).filter((k) => k !== "")),
  );
  return {
    title: title.slice(0, 70),
    metaDescription: metaDescription.slice(0, 160),
    keywords,
    meta: TEMPLATE_META,
  };
}

export function suggestImageAlt(input: ProductAssistInput, imageIndex: number): AltSuggestion {
  const p = input.product;
  const suffix = imageIndex > 0 ? ` (${imageIndex + 1})` : "";
  return {
    altBn: `${p.title.bn} — ${p.categoryName.bn}${suffix}`,
    altEn: `${p.title.en} — ${p.categoryName.en}${suffix}`,
    meta: TEMPLATE_META,
  };
}
