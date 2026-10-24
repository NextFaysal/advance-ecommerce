// Landing in-memory demo store — Agent 53.
// TEMPORARY DEMO persistence, same pattern as the CMS store: swap for a
// Prisma-backed store (landing_pages table / CmsPage-adjacent) when the
// DB lands, without changing validate/render contracts.
// Seeded with ONE sample campaign for the TEMPORARY MOCK Jamdani product.
import type { LandingPage } from "./types";
import { transitionLandingStatus } from "./validate";
import type { LandingCatalogProduct } from "./types";

export const SAMPLE_LANDING_PAGE: LandingPage = {
  id: "lp_sample_jamdani_eid",
  slug: "jamdani-eid-offer",
  titleBn: "জামদানি শাড়ি — ঈদ অফার",
  titleEn: "Jamdani Sharee — Eid Offer",
  status: "PUBLISHED",
  sections: [
    {
      id: "sec_sample_hero", type: "hero",
      titleBn: "আসল জামদানি শাড়ি, এখন বিশেষ ছাড়ে",
      titleEn: "Authentic Jamdani Sharee, now on special offer",
      subtitleBn: "হাতে বোনা, নরম সুতি — ঈদ ও বিয়ের জন্য সেরা পছন্দ। সারাদেশে হোম ডেলিভারি।",
      subtitleEn: "Hand-woven soft cotton — perfect for Eid and weddings. Home delivery nationwide.",
      imageUrl: "/placeholder/sharee.jpg",
      ctaLabelBn: "এখনই অর্ডার করুন", ctaLabelEn: "Order Now",
    },
    {
      id: "sec_sample_offer", type: "product_offer",
      productId: "prod-1", variantId: "v-1",
      discountNoteBn: "সীমিত সময়ের অফার — আগের দামের চেয়ে কমে পাচ্ছেন",
      discountNoteEn: "Limited-time offer — below the regular price",
      showCountdown: true, countdownEndsAt: "2026-11-15T23:59:59.000Z",
    },
    {
      id: "sec_sample_benefits", type: "benefits",
      headingBn: "কেন এই জামদানি?", headingEn: "Why this Jamdani?",
      items: [
        { icon: "🧵", textBn: "১০০% হাতে বোনা আসল জামদানি", textEn: "100% hand-woven authentic Jamdani" },
        { icon: "🚚", textBn: "সারাদেশে হোম ডেলিভারি", textEn: "Home delivery across Bangladesh" },
        { icon: "💵", textBn: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন", textEn: "Cash on Delivery — pay in hand" },
        { icon: "↩️", textBn: "ত্রুটি থাকলে সহজ রিটার্ন", textEn: "Easy return if defective" },
      ],
    },
    {
      id: "sec_sample_how", type: "how_to_order",
      headingBn: "কীভাবে অর্ডার করবেন", headingEn: "How to Order",
      steps: [
        { textBn: "নিচের “এখনই অর্ডার করুন” বোতামে চাপ দিন", textEn: "Tap the Order Now button below" },
        { textBn: "নাম, মোবাইল নম্বর ও ঠিকানা দিয়ে অর্ডার সম্পন্ন করুন", textEn: "Complete the order with your name, mobile number and address" },
        { textBn: "আমাদের টিম ফোনে নিশ্চিত করবে, পণ্য হাতে পেয়ে টাকা দিন", textEn: "Our team confirms by phone; pay when the product is in your hand" },
      ],
    },
    {
      id: "sec_sample_faq", type: "faq",
      headingBn: "সাধারণ জিজ্ঞাসা", headingEn: "FAQ",
      items: [
        { questionBn: "ডেলিভারি পেতে কতদিন লাগবে?", questionEn: "How long does delivery take?", answerBn: "ঢাকায় ২৪–৪৮ ঘণ্টা, ঢাকার বাইরে ২–৪ দিন।", answerEn: "24–48 hours inside Dhaka, 2–4 days outside." },
        { questionBn: "অগ্রিম টাকা দিতে হবে কি?", questionEn: "Do I need to pay in advance?", answerBn: "না — ক্যাশ অন ডেলিভারি, পণ্য হাতে পেয়ে টাকা দেবেন।", answerEn: "No — Cash on Delivery; pay when the product is in your hand." },
      ],
    },
    {
      id: "sec_sample_note", type: "order_form_note",
      textBn: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে যাচাই করে তারপর টাকা দিন। কোনো অগ্রিম পেমেন্ট লাগবে না।",
      textEn: "Cash on Delivery — check the product in hand, then pay. No advance payment needed.",
    },
    {
      id: "sec_sample_footer", type: "footer_note",
      textBn: "অফারটি স্টক থাকা সাপেক্ষে প্রযোজ্য। (SAMPLE ল্যান্ডিং পেজ — TEMPORARY DEMO)",
      textEn: "Offer valid while stock lasts. (SAMPLE landing page — TEMPORARY DEMO)",
    },
  ],
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};

export class LandingStore {
  private pages = new Map<string, LandingPage>();

  constructor(seed: readonly LandingPage[] = [SAMPLE_LANDING_PAGE]) {
    for (const p of seed) this.pages.set(p.id, p);
  }

  list(): LandingPage[] {
    return [...this.pages.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).reverse();
  }

  get(id: string): LandingPage | undefined {
    return this.pages.get(id);
  }

  getBySlug(slug: string): LandingPage | undefined {
    return [...this.pages.values()].find((p) => p.slug === slug);
  }

  /** Only PUBLISHED pages are publicly visible — drafts/archived return undefined here. */
  getPublishedBySlug(slug: string): LandingPage | undefined {
    const page = this.getBySlug(slug);
    return page && page.status === "PUBLISHED" ? page : undefined;
  }

  otherSlugs(excludeId?: string): string[] {
    return [...this.pages.values()].filter((p) => p.id !== excludeId).map((p) => p.slug);
  }

  create(input: Omit<LandingPage, "id" | "createdAt" | "updatedAt">): LandingPage {
    if (this.getBySlug(input.slug)) throw new Error("slug_already_exists");
    const now = new Date().toISOString();
    const page: LandingPage = { ...input, id: `lp_${Date.now().toString(36)}`, createdAt: now, updatedAt: now };
    this.pages.set(page.id, page);
    return page;
  }

  update(id: string, input: Omit<LandingPage, "id" | "createdAt" | "updatedAt">): LandingPage {
    const existing = this.pages.get(id);
    if (!existing) throw new Error("landing_page_not_found");
    const clash = this.getBySlug(input.slug);
    if (clash && clash.id !== id) throw new Error("slug_already_exists");
    const updated: LandingPage = { ...existing, ...input, updatedAt: new Date().toISOString() };
    this.pages.set(id, updated);
    return updated;
  }

  setStatus(id: string, to: LandingPage["status"], catalog: readonly LandingCatalogProduct[]) {
    const existing = this.pages.get(id);
    if (!existing) throw new Error("landing_page_not_found");
    const result = transitionLandingStatus(existing, to, catalog, this.otherSlugs(id));
    if (!result.ok) return result;
    this.pages.set(id, result.page);
    return result;
  }

  delete(id: string): boolean {
    return this.pages.delete(id);
  }
}

/** Shared in-memory singleton for the landing API routes + public page (stub persistence). */
export const landingStore = new LandingStore();
