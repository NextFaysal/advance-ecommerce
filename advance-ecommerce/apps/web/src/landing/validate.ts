// Landing page validation + status flow — Agent 53. Pure functions only.
import { z } from "zod";
import type { LandingCatalogProduct, LandingPage, LandingSection, LandingStatus } from "./types";

export const landingSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case");

const benefitItemSchema = z.object({ icon: z.string().max(8), textBn: z.string(), textEn: z.string() });
const faqItemSchema = z.object({ questionBn: z.string(), questionEn: z.string(), answerBn: z.string(), answerEn: z.string() });
const stepSchema = z.object({ textBn: z.string(), textEn: z.string() });

export const landingSectionSchema: z.ZodType<LandingSection> = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1), type: z.literal("hero"),
    titleBn: z.string(), titleEn: z.string(), subtitleBn: z.string(), subtitleEn: z.string(),
    imageUrl: z.string().nullable(), ctaLabelBn: z.string(), ctaLabelEn: z.string(),
  }),
  z.object({
    id: z.string().min(1), type: z.literal("product_offer"),
    productId: z.string(), variantId: z.string().nullable(),
    discountNoteBn: z.string(), discountNoteEn: z.string(),
    showCountdown: z.boolean(), countdownEndsAt: z.string().nullable(),
  }),
  z.object({ id: z.string().min(1), type: z.literal("benefits"), headingBn: z.string(), headingEn: z.string(), items: z.array(benefitItemSchema) }),
  z.object({ id: z.string().min(1), type: z.literal("how_to_order"), headingBn: z.string(), headingEn: z.string(), steps: z.array(stepSchema) }),
  z.object({ id: z.string().min(1), type: z.literal("faq"), headingBn: z.string(), headingEn: z.string(), items: z.array(faqItemSchema) }),
  z.object({ id: z.string().min(1), type: z.literal("order_form_note"), textBn: z.string(), textEn: z.string() }),
  z.object({
    id: z.string().min(1), type: z.literal("quick_order"),
    productId: z.string(), variantId: z.string().nullable(),
    headingBn: z.string(), headingEn: z.string(),
  }),
  z.object({ id: z.string().min(1), type: z.literal("footer_note"), textBn: z.string(), textEn: z.string() }),
]);

export const landingPageInputSchema = z.object({
  slug: landingSlugSchema,
  titleBn: z.string().min(1),
  titleEn: z.string().min(1),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  sections: z.array(landingSectionSchema).min(1),
  // Envelope v2 (doc 34 §3.1): stored verbatim, not publish-gated in
  // L1 — SEO is honoured at metadata render, the schedule window is
  // evaluated lazily at read in the store. Optional so every v1-era
  // caller (and the current builder, which gains the fields in L6)
  // keeps posting exactly what it posts today.
  seo: z
    .object({
      metaTitleBn: z.string(),
      metaTitleEn: z.string(),
      metaDescriptionBn: z.string(),
      metaDescriptionEn: z.string(),
      ogImageUrl: z.string().nullable(),
    })
    .optional(),
  schedule: z
    .object({
      publishAt: z.string().nullable(),
      expiresAt: z.string().nullable(),
    })
    .optional(),
});
export type LandingPageInput = z.infer<typeof landingPageInputSchema>;

export interface LandingValidationError {
  code: string;
  messageBn: string;
  messageEn: string;
  sectionId?: string;
}

export interface LandingValidationResult {
  ok: boolean;
  errors: LandingValidationError[];
}

/**
 * Validate a landing page against a catalog list.
 * Rules: kebab slug + unique vs `otherSlugs`; title present; at least one
 * hero AND one product_offer; every product_offer's product (and variant,
 * when set) resolves in `catalog`; hero titles and CTA labels present;
 * benefits/faq items not empty-text. Publishing requires ok === true —
 * enforced by transitionToStatus() below.
 */
export function validateLandingPage(
  page: Pick<LandingPage, "slug" | "titleBn" | "titleEn" | "sections">,
  catalog: readonly LandingCatalogProduct[],
  otherSlugs: readonly string[] = [],
): LandingValidationResult {
  const errors: LandingValidationError[] = [];
  const err = (code: string, messageBn: string, messageEn: string, sectionId?: string) =>
    errors.push({ code, messageBn, messageEn, sectionId });

  if (!landingSlugSchema.safeParse(page.slug).success) {
    err("SLUG_NOT_KEBAB", "স্লাগ অবশ্যই ছোট হাতের kebab-case হতে হবে (যেমন jamdani-eid-offer)।", "Slug must be lowercase kebab-case.");
  } else if (otherSlugs.includes(page.slug)) {
    err("SLUG_NOT_UNIQUE", "এই স্লাগে ইতিমধ্যে আরেকটি ল্যান্ডিং পেজ আছে।", "A landing page with this slug already exists.");
  }
  if (!page.titleBn.trim() || !page.titleEn.trim()) {
    err("TITLE_REQUIRED", "পেজের শিরোনাম (বাংলা ও ইংরেজি) আবশ্যক।", "Page title (bn + en) is required.");
  }

  const heroes = page.sections.filter((s) => s.type === "hero");
  const offers = page.sections.filter((s) => s.type === "product_offer");
  if (heroes.length === 0) err("HERO_REQUIRED", "অন্তত একটি হিরো সেকশন আবশ্যক।", "At least one hero section is required.");
  if (offers.length === 0) err("PRODUCT_OFFER_REQUIRED", "অন্তত একটি পণ্যের অফার সেকশন আবশ্যক।", "At least one product offer section is required.");

  const seenIds = new Set<string>();
  for (const section of page.sections) {
    if (seenIds.has(section.id)) err("DUPLICATE_SECTION_ID", "দুটি সেকশনের আইডি এক হয়ে গেছে।", "Duplicate section id.", section.id);
    seenIds.add(section.id);
    switch (section.type) {
      case "hero":
        if (!section.titleBn.trim()) err("HERO_TITLE_REQUIRED", "হিরোর বাংলা শিরোনাম আবশ্যক।", "Hero Bangla title is required.", section.id);
        if (!section.ctaLabelBn.trim()) err("HERO_CTA_REQUIRED", "হিরোর বোতামের লেখা আবশ্যক।", "Hero CTA label is required.", section.id);
        break;
      case "product_offer": {
        const product = catalog.find((p) => p.id === section.productId);
        if (!section.productId || !product) {
          err("PRODUCT_NOT_FOUND", "অফারের পণ্যটি ক্যাটালগে পাওয়া যায়নি।", "Offer product does not resolve in the catalog.", section.id);
        } else if (section.variantId && !product.variants.some((v) => v.id === section.variantId)) {
          err("VARIANT_NOT_FOUND", "অফারের ভেরিয়েন্টটি ওই পণ্যে পাওয়া যায়নি।", "Offer variant does not resolve on that product.", section.id);
        }
        if (section.showCountdown && section.countdownEndsAt && Number.isNaN(Date.parse(section.countdownEndsAt))) {
          err("COUNTDOWN_INVALID", "কাউন্টডাউনের তারিখ সঠিক নয়।", "Countdown end date is invalid.", section.id);
        }
        break;
      }
      case "quick_order": {
        // Same linkage rules as product_offer: the product (and the
        // pinned default variant, when set) must resolve in the catalog.
        const product = catalog.find((p) => p.id === section.productId);
        if (!section.productId || !product) {
          err("PRODUCT_NOT_FOUND", "অর্ডার ফর্মের পণ্যটি ক্যাটালগে পাওয়া যায়নি।", "Order form product does not resolve in the catalog.", section.id);
        } else if (section.variantId && !product.variants.some((v) => v.id === section.variantId)) {
          err("VARIANT_NOT_FOUND", "অর্ডার ফর্মের ভেরিয়েন্টটি ওই পণ্যে পাওয়া যায়নি।", "Order form variant does not resolve on that product.", section.id);
        }
        break;
      }
      case "benefits":
        if (section.items.length === 0 || section.items.some((i) => !i.textBn.trim())) {
          err("BENEFIT_TEXT_REQUIRED", "প্রতিটি সুবিধার বাংলা লেখা আবশ্যক।", "Every benefit needs Bangla text.", section.id);
        }
        break;
      case "faq":
        if (section.items.some((i) => !i.questionBn.trim() || !i.answerBn.trim())) {
          err("FAQ_TEXT_REQUIRED", "প্রতিটি প্রশ্ন ও উত্তরের বাংলা লেখা আবশ্যক।", "Every FAQ item needs Bangla question and answer.", section.id);
        }
        break;
      case "how_to_order":
        if (section.steps.length === 0) err("STEPS_REQUIRED", "অন্তত একটি অর্ডারের ধাপ আবশ্যক।", "At least one ordering step is required.", section.id);
        break;
      default:
        break;
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---- Status flow ---------------------------------------------------------
// DRAFT -> PUBLISHED -> ARCHIVED is the campaign lifecycle; unpublish
// (PUBLISHED -> DRAFT) and restore (ARCHIVED -> DRAFT) are also allowed so
// a campaign can be fixed and re-run. Only PUBLISHED is publicly visible.

const ALLOWED: Record<LandingStatus, readonly LandingStatus[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED", "DRAFT"],
  ARCHIVED: ["DRAFT"],
};

export function canTransitionLanding(from: LandingStatus, to: LandingStatus): boolean {
  return from === to || ALLOWED[from].includes(to);
}

export type LandingTransitionResult =
  | { ok: true; page: LandingPage }
  | { ok: false; code: string; messageBn: string; messageEn: string; validation?: LandingValidationResult };

/** Apply a status transition. Publishing re-validates against the catalog. */
export function transitionLandingStatus(
  page: LandingPage,
  to: LandingStatus,
  catalog: readonly LandingCatalogProduct[],
  otherSlugs: readonly string[] = [],
): LandingTransitionResult {
  if (!canTransitionLanding(page.status, to)) {
    return { ok: false, code: "INVALID_TRANSITION", messageBn: `অবস্থা ${page.status} থেকে ${to}-তে যাওয়া যায় না।`, messageEn: `Cannot move from ${page.status} to ${to}.` };
  }
  if (to === "PUBLISHED") {
    const validation = validateLandingPage(page, catalog, otherSlugs);
    if (!validation.ok) {
      return { ok: false, code: "VALIDATION_FAILED", messageBn: "যাচাই ব্যর্থ — প্রকাশ করা যাচ্ছে না।", messageEn: "Validation failed — cannot publish.", validation };
    }
  }
  return { ok: true, page: { ...page, status: to, updatedAt: new Date().toISOString() } };
}
