// Landing page builder — types (Agent 53).
// Campaign landing pages for BD F-commerce: ad -> landing -> COD order.
// A landing page is a SEPARATE, simpler section-based model from the CMS
// (src/reports/cms.ts): CMS pages are free-form body text; landing pages
// are an ordered list of typed blocks rendered by src/landing/render.ts.
// Money: any price comes from catalog data as integer poisha — landing
// pages never store or recompute prices.

export type LandingStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type LandingSectionType =
  | "hero"
  | "product_offer"
  | "benefits"
  | "how_to_order"
  | "faq"
  | "order_form_note"
  | "quick_order"
  | "footer_note";

export interface HeroSection {
  id: string;
  type: "hero";
  titleBn: string;
  titleEn: string;
  subtitleBn: string;
  subtitleEn: string;
  imageUrl: string | null;
  ctaLabelBn: string;
  ctaLabelEn: string;
}

export interface ProductOfferSection {
  id: string;
  type: "product_offer";
  /** Catalog product id — must resolve against the provided catalog. */
  productId: string;
  /** Specific variant id, or null = the product's first in-stock variant. */
  variantId: string | null;
  discountNoteBn: string;
  discountNoteEn: string;
  showCountdown: boolean;
  /** ISO datetime the offer ends, or null (only used when showCountdown). */
  countdownEndsAt: string | null;
}

export interface BenefitItem {
  /** Short icon glyph / emoji shown beside the text. */
  icon: string;
  textBn: string;
  textEn: string;
}

export interface BenefitsSection {
  id: string;
  type: "benefits";
  headingBn: string;
  headingEn: string;
  items: BenefitItem[];
}

export interface HowToOrderStep {
  textBn: string;
  textEn: string;
}

export interface HowToOrderSection {
  id: string;
  type: "how_to_order";
  headingBn: string;
  headingEn: string;
  steps: HowToOrderStep[];
}

export interface FaqItem {
  questionBn: string;
  questionEn: string;
  answerBn: string;
  answerEn: string;
}

export interface FaqSection {
  id: string;
  type: "faq";
  headingBn: string;
  headingEn: string;
  items: FaqItem[];
}

export interface OrderFormNoteSection {
  id: string;
  type: "order_form_note";
  /** COD reassurance copy, e.g. "পণ্য হাতে পেয়ে টাকা দিন". */
  textBn: string;
  textEn: string;
}

/**
 * One-page COD order form for the linked product (plan 17 batch O2):
 * name + phone + address + variant/qty, submitted straight to
 * POST /api/v1/public/orders — the classic BD landing flow where the
 * customer never leaves the page. Product linkage mirrors
 * ProductOfferSection: a catalog productId plus an optional pinned
 * variantId (the form's default selection; the customer can still
 * pick another variant of the same product).
 */
export interface QuickOrderSection {
  id: string;
  type: "quick_order";
  /** Catalog product id — must resolve against the provided catalog. */
  productId: string;
  /** Default variant id, or null = the product's first in-stock variant. */
  variantId: string | null;
  headingBn: string;
  headingEn: string;
}

export interface FooterNoteSection {
  id: string;
  type: "footer_note";
  textBn: string;
  textEn: string;
}

export type LandingSection =
  | HeroSection
  | ProductOfferSection
  | BenefitsSection
  | HowToOrderSection
  | FaqSection
  | OrderFormNoteSection
  | QuickOrderSection
  | FooterNoteSection;

export interface LandingPage {
  id: string;
  /** Lowercase kebab-case, unique across landing pages — public URL /lp/<slug>. */
  slug: string;
  titleBn: string;
  titleEn: string;
  status: LandingStatus;
  sections: LandingSection[];
  createdAt: string;
  updatedAt: string;
}

/** Minimal catalog shape validation/rendering needs (satisfied by the
 *  TEMPORARY MOCK catalog Product and by the future Prisma service). */
export interface LandingCatalogVariant {
  id: string;
  sku: string;
  pricePoisha: number;
  compareAtPoisha: number | null;
  stock: number;
  isActive: boolean;
  imageUrl: string | null;
  attributes: Record<string, string>;
}

export interface LandingCatalogProduct {
  id: string;
  slug: string;
  title: { bn: string; en: string };
  images: Array<{ url: string }>;
  variants: LandingCatalogVariant[];
}

export const LANDING_SECTION_LABELS: Record<LandingSectionType, { bn: string; en: string }> = {
  hero: { bn: "হিরো", en: "Hero" },
  product_offer: { bn: "পণ্যের অফার", en: "Product Offer" },
  benefits: { bn: "সুবিধা", en: "Benefits" },
  how_to_order: { bn: "কীভাবে অর্ডার করবেন", en: "How to Order" },
  faq: { bn: "সাধারণ জিজ্ঞাসা", en: "FAQ" },
  order_form_note: { bn: "অর্ডার ফর্ম নোট (COD)", en: "Order Form Note" },
  quick_order: { bn: "অর্ডার ফর্ম (COD)", en: "Order Form (COD)" },
  footer_note: { bn: "ফুটার নোট", en: "Footer Note" },
};

let sectionCounter = 0;
/** New section id for builder-created blocks (deterministic prefix + counter/random suffix). */
export function newSectionId(type: LandingSectionType): string {
  sectionCounter += 1;
  return `sec_${type}_${Date.now().toString(36)}_${sectionCounter}`;
}

/** Blank section of a type with sensible Bangla-first defaults (builder palette). */
export function createEmptySection(type: LandingSectionType): LandingSection {
  const id = newSectionId(type);
  switch (type) {
    case "hero":
      return { id, type, titleBn: "", titleEn: "", subtitleBn: "", subtitleEn: "", imageUrl: null, ctaLabelBn: "এখনই অর্ডার করুন", ctaLabelEn: "Order Now" };
    case "product_offer":
      return { id, type, productId: "", variantId: null, discountNoteBn: "", discountNoteEn: "", showCountdown: false, countdownEndsAt: null };
    case "benefits":
      return { id, type, headingBn: "কেন এই পণ্য?", headingEn: "Why this product?", items: [{ icon: "✅", textBn: "", textEn: "" }] };
    case "how_to_order":
      return {
        id, type, headingBn: "কীভাবে অর্ডার করবেন", headingEn: "How to Order",
        steps: [
          { textBn: "“এখনই অর্ডার করুন” বোতামে চাপ দিন", textEn: "Tap the Order Now button" },
          { textBn: "নাম, মোবাইল নম্বর ও ঠিকানা দিন", textEn: "Enter your name, mobile number and address" },
          { textBn: "পণ্য হাতে পেয়ে টাকা পরিশোধ করুন (COD)", textEn: "Pay when the product is in your hand (COD)" },
        ],
      };
    case "faq":
      return { id, type, headingBn: "সাধারণ জিজ্ঞাসা", headingEn: "FAQ", items: [{ questionBn: "", questionEn: "", answerBn: "", answerEn: "" }] };
    case "order_form_note":
      return { id, type, textBn: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে যাচাই করে তারপর টাকা দিন। কোনো অগ্রিম পেমেন্ট লাগবে না।", textEn: "Cash on Delivery — check the product in hand, then pay. No advance payment needed." };
    case "quick_order":
      return { id, type, productId: "", variantId: null, headingBn: "অর্ডার করুন — ক্যাশ অন ডেলিভারি", headingEn: "Order now — Cash on Delivery" };
    case "footer_note":
      return { id, type, textBn: "", textEn: "" };
  }
}
