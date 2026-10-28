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
  | "footer_note"
  // Doc 34 L3 (block library II) — proof + media blocks. Added
  // additively to the v2 union (§3.3): v1 pages never carry them and
  // older validators simply never see them.
  | "reviews"
  | "gallery"
  | "image_banner"
  | "video"
  | "rich_text"
  | "bundle_offer"
  // Doc 34 L2 (block library I) — dynamic product blocks, the
  // standalone countdown and the trust strip. Same additive rule:
  // v2 union only, v1 pages never carry them.
  | "product_grid"
  | "product_carousel"
  | "countdown"
  | "trust_strip"
  // Doc 34 L2a (§3.2) — the sticky order bar. Was in L2a's brief
  // alongside the grid/carousel but never built; recovered as its
  // own slice. Same additive rule: v2 union only.
  | "sticky_bar";

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
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
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
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
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
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
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
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
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
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

export interface OrderFormNoteSection {
  id: string;
  type: "order_form_note";
  /** COD reassurance copy, e.g. "পণ্য হাতে পেয়ে টাকা দিন". */
  textBn: string;
  textEn: string;
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
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
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

export interface FooterNoteSection {
  id: string;
  type: "footer_note";
  textBn: string;
  textEn: string;
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

/**
 * Customer reviews block (doc 34 §3.2, L3). Renders APPROVED Review
 * rows of ONE real product — never placeholder testimonials (§0.7):
 * when the product has no approved reviews at/above `minRating`, the
 * block renders nothing at all. `usePrimaryOffer` binds the block to
 * the page's first product_offer product at render time, so a
 * single-product campaign needs no second product pick.
 */
export interface ReviewsSection {
  id: string;
  type: "reviews";
  /** Catalog product id — ignored when usePrimaryOffer is true. */
  productId: string;
  usePrimaryOffer: boolean;
  /** Max review cards shown (1–20). */
  limit: number;
  /** Only reviews with rating >= minRating are listed (1–5). The
   *  aggregate header always reports the product's TRUE approved
   *  average/count, unfiltered — the filter shapes the list, never
   *  the numbers. */
  minRating: number;
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

export interface GalleryImage {
  url: string;
  altBn: string;
  altEn: string;
}

export interface GallerySection {
  id: string;
  type: "gallery";
  headingBn: string;
  headingEn: string;
  images: GalleryImage[];
  /** grid = responsive tile grid; carousel = doc-33 snap rail. */
  layout: "grid" | "carousel";
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

export interface ImageBannerSection {
  id: string;
  type: "image_banner";
  imageUrl: string;
  altBn: string;
  altEn: string;
  /** Optional click target (https://… or an in-store /path). */
  linkUrl: string | null;
  headingBn: string;
  headingEn: string;
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

export interface VideoSection {
  id: string;
  type: "video";
  /** §5 decision 3: YouTube only in v1 — nocookie, click-to-load. */
  provider: "youtube";
  videoId: string;
  headingBn: string;
  headingEn: string;
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

/**
 * Long-form copy block (doc 34 §3.2, L3). Bodies are markdown-lite,
 * rendered through the catalog's escape-first renderer
 * (src/catalog/description.ts — the PDP/blog sanitizer): headings,
 * bold/italic, http(s) links and bullet lists ONLY. Raw HTML in the
 * body is escaped text, never markup (§5 decision 1: no HTML block).
 */
export interface RichTextSection {
  id: string;
  type: "rich_text";
  bodyBn: string;
  bodyEn: string;
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

/**
 * Bundle offer block (doc 34 §3.2, L3): a real BUNDLE product with
 * its live BundleComponent contents list, the components-sum vs
 * bundle-price comparison (the bundle-builder page's own read model)
 * and a buy action. Price/variant/stock resolve live through the
 * offer resolver, exactly like product_offer; a product that is not
 * an available bundle renders nothing.
 */
export interface BundleOfferSection {
  id: string;
  type: "bundle_offer";
  /** Catalog product id of a BUNDLE product. */
  productId: string;
  /** Specific bundle variant id, or null = the offer resolver's pick. */
  variantId: string | null;
  headingBn: string;
  headingEn: string;
  /** Also show a CTA that scrolls to the page's quick_order form. */
  ctaToOrderForm: boolean;
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

/**
 * Dynamic product source (doc 34 §3.4) — shared by product_grid and
 * product_carousel. A source is a QUERY, never a frozen list: at
 * render time it resolves through LandingCatalogQueries against the
 * live catalog, so prices/stock/membership are always current and a
 * product that goes inactive simply drops out (§0.2, §0.7).
 *  - manual: owner-picked ids, order preserved;
 *  - category / tag: live membership of that category slug / tag;
 *  - best_sellers: the real paid-sales aggregate (topSold);
 *  - new_arrivals: newest ACTIVE products.
 */
export type LandingProductSource =
  | { kind: "manual"; productIds: string[] }
  | { kind: "category"; slug: string }
  | { kind: "tag"; tag: string }
  | { kind: "best_sellers" }
  | { kind: "new_arrivals" };

/**
 * Dynamic product grid (doc 34 §3.2, L2). Cells are the landing
 * product-card shape (image / title / live price / stock) resolved
 * from `source` at render; a source resolving to zero products
 * renders nothing at all (no empty shell, §3.4).
 */
export interface ProductGridSection {
  id: string;
  type: "product_grid";
  source: LandingProductSource;
  /** Max products shown (4–24). */
  limit: number;
  headingBn: string;
  headingEn: string;
  /** Grid columns below the md breakpoint (1 or 2). */
  columnsMobile: 1 | 2;
  /** Grid columns at md and up (2, 3 or 4). */
  columnsDesktop: 2 | 3 | 4;
  showPrice: boolean;
  showAddButton: boolean;
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

/**
 * Dynamic product carousel (doc 34 §3.2, L2): the same source spec
 * as the grid, presented as the doc-33 snap rail (fade + snap +
 * 44px arrows) instead of a static grid.
 */
export interface ProductCarouselSection {
  id: string;
  type: "product_carousel";
  source: LandingProductSource;
  /** Max products shown (4–24). */
  limit: number;
  headingBn: string;
  headingEn: string;
  /** Auto-advance the rail (paused on hover/focus; off entirely
   *  under prefers-reduced-motion). */
  autoplay: boolean;
  showPrice: boolean;
  showAddButton: boolean;
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

/**
 * Standalone countdown block (doc 34 §3.2, L2) — the digit-box
 * successor of product_offer's inline CountdownNote. The target is
 * either an explicit datetime the owner configured, or the LIVE
 * flash sale's own end (resolved at render via getLiveFlashSale —
 * the block stores no date of its own in that mode). §0.7: with no
 * real configured end (flash-sale mode and no sale live) the block
 * renders nothing; an expired countdown NEVER resets to a fake new
 * deadline — it hides or shows the owner's expired text.
 */
export interface CountdownSection {
  id: string;
  type: "countdown";
  target:
    | { kind: "datetime"; endsAt: string }
    | { kind: "flash_sale" };
  headingBn: string;
  headingEn: string;
  /** What happens once the target passes: hide the block, or keep
   *  it showing expiredTextBn/En. */
  expiredBehavior: "hide" | "show_text";
  expiredTextBn: string;
  expiredTextEn: string;
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

/** The five preset guarantees of the trust strip (§3.2). Presets
 *  carry dictionary-grade default copy + icon (below); an owner may
 *  still edit an item's copy after picking a preset, or use a fully
 *  custom item. The builder never invents claims — every item on a
 *  page was placed there by the owner (§0.7). */
export type TrustPresetKey = "cod" | "home_delivery" | "easy_return" | "authentic" | "support";

export interface TrustStripItem {
  preset: TrustPresetKey | "custom";
  /** Short icon glyph / emoji shown beside the text. */
  icon: string;
  textBn: string;
  textEn: string;
}

/** Trust / guarantee strip (doc 34 §3.2, L2): a compact row of
 *  reassurance items — the dedicated form of what owners used to
 *  fake with `benefits`. */
export interface TrustStripSection {
  id: string;
  type: "trust_strip";
  items: TrustStripItem[];
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

/**
 * Sticky order bar (doc 34 §3.2, L2a — recovered slice). A fixed
 * bottom bar on the public page (mobile-first: hidden at md+,
 * safe-area padded) showing the page's PRIMARY OFFER's live price —
 * resolved at render through the same resolveOffer path as
 * product_offer; the section stores NO price and NO product ref of
 * its own, so the bar can never drift from the offer card. It
 * renders nothing at all when the page has no resolvable offer, and
 * an out-of-stock offer turns the CTA into the stock state (no dead
 * button). `textBn/En` are the owner's optional label line beside
 * the price (empty = the product's title shows instead); the CTA
 * label itself is dictionary chrome (defaultCta), as everywhere
 * else in the renderer.
 */
export interface StickyBarSection {
  id: string;
  type: "sticky_bar";
  /** Optional owner label line (may be empty). */
  textBn: string;
  textEn: string;
  /** Where the CTA scrolls: the primary offer's section, or the
   *  page's quick-order form (#landing-order-form). */
  target: "primary_offer" | "quick_order";
  /** Per-section design controls (doc 34 §3.5) — absent = today's rendering. */
  design?: LandingSectionDesign;
}

export const LANDING_TRUST_PRESETS: Record<TrustPresetKey, { icon: string; textBn: string; textEn: string }> = {
  cod: { icon: "💵", textBn: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন", textEn: "Cash on Delivery — pay when the product is in your hand" },
  home_delivery: { icon: "🚚", textBn: "সারাদেশে হোম ডেলিভারি", textEn: "Home delivery across Bangladesh" },
  easy_return: { icon: "↩️", textBn: "ত্রুটিপূর্ণ পণ্যে সহজ রিটার্ন", textEn: "Easy return on defective products" },
  authentic: { icon: "✅", textBn: "১০০% আসল পণ্যের নিশ্চয়তা", textEn: "100% genuine products, guaranteed" },
  support: { icon: "📞", textBn: "সকাল ৯টা — রাত ৯টা কাস্টমার সাপোর্ট", textEn: "Customer support, 9 AM – 9 PM" },
};

/**
 * Per-section design controls (doc 34 §3.5, L4) — ONE optional
 * object addable to every section type in v2 pages. Every field is
 * optional and ABSENT means "exactly today's rendering": the
 * renderer applies a design wrapper ONLY when a design object is
 * present and changes something, so a design-less section renders
 * byte-identically to before L4 (§0.8). Values are token preset
 * NAMES, never raw colour/spacing values (§0.6): the renderer maps
 * them through static class lookups.
 *  - bg: the band painted behind the section.
 *  - paddingY: extra vertical breathing room around the section.
 *  - hiddenOn: suppress the section on one device class.
 *  - enabled: false = the section stays in the page data (the
 *    builder shows it dimmed) but renders nothing anywhere.
 */
export interface LandingSectionDesign {
  bg?: "none" | "card" | "surface" | "brand" | "dark";
  paddingY?: "sm" | "md" | "lg";
  hiddenOn?: "mobile" | "desktop";
  enabled?: boolean;
}

export type LandingSection =
  | HeroSection
  | ProductOfferSection
  | BenefitsSection
  | HowToOrderSection
  | FaqSection
  | OrderFormNoteSection
  | QuickOrderSection
  | FooterNoteSection
  | ReviewsSection
  | GallerySection
  | ImageBannerSection
  | VideoSection
  | RichTextSection
  | BundleOfferSection
  | ProductGridSection
  | ProductCarouselSection
  | CountdownSection
  | TrustStripSection
  | StickyBarSection;

/**
 * Page-level SEO overrides (doc 34 §3.1, envelope v2). All fields are
 * owner copy; an absent seo object (every v1 page) means the public
 * page falls back to the page titles exactly as before. Surfaced in
 * the builder's Page Settings in L6 — L1 only stores/round-trips it.
 */
export interface LandingSeo {
  metaTitleBn: string;
  metaTitleEn: string;
  metaDescriptionBn: string;
  metaDescriptionEn: string;
  ogImageUrl: string | null;
}

/**
 * Publish window (doc 34 §3.1, envelope v2). Evaluated LAZILY at
 * read in the store's getPublishedBySlug — no cron/worker flips
 * anything (the worker host is VPS-day-gated): a PUBLISHED page is
 * publicly visible only while `now` is inside [publishAt, expiresAt].
 * Absent schedule (every v1 page) = no window, as before.
 */
export interface LandingSchedule {
  publishAt: string | null;
  expiresAt: string | null;
}

export interface LandingPage {
  id: string;
  /** Lowercase kebab-case, unique across landing pages — public URL /lp/<slug>. */
  slug: string;
  titleBn: string;
  titleEn: string;
  status: LandingStatus;
  sections: LandingSection[];
  /** Envelope v2 additions — absent on v1-written pages. */
  seo?: LandingSeo;
  schedule?: LandingSchedule;
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
  reviews: { bn: "ক্রেতাদের রিভিউ", en: "Customer Reviews" },
  gallery: { bn: "ছবির গ্যালারি", en: "Image Gallery" },
  image_banner: { bn: "ছবির ব্যানার", en: "Image Banner" },
  video: { bn: "ভিডিও (YouTube)", en: "Video (YouTube)" },
  rich_text: { bn: "বিস্তারিত লেখা", en: "Rich Text" },
  bundle_offer: { bn: "বান্ডল অফার", en: "Bundle Offer" },
  product_grid: { bn: "পণ্যের গ্রিড", en: "Product Grid" },
  product_carousel: { bn: "পণ্যের ক্যারোসেল", en: "Product Carousel" },
  countdown: { bn: "কাউন্টডাউন", en: "Countdown" },
  trust_strip: { bn: "আস্থার স্ট্রিপ", en: "Trust Strip" },
  sticky_bar: { bn: "স্টিকি অর্ডার বার", en: "Sticky Order Bar" },
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
    case "reviews":
      return { id, type, productId: "", usePrimaryOffer: true, limit: 6, minRating: 1 };
    case "gallery":
      return { id, type, headingBn: "গ্যালারি", headingEn: "Gallery", images: [{ url: "", altBn: "", altEn: "" }], layout: "grid" };
    case "image_banner":
      return { id, type, imageUrl: "", altBn: "", altEn: "", linkUrl: null, headingBn: "", headingEn: "" };
    case "video":
      return { id, type, provider: "youtube", videoId: "", headingBn: "", headingEn: "" };
    case "rich_text":
      return { id, type, bodyBn: "", bodyEn: "" };
    case "bundle_offer":
      return { id, type, productId: "", variantId: null, headingBn: "বান্ডল অফার", headingEn: "Bundle Offer", ctaToOrderForm: true };
    case "product_grid":
      return {
        id, type, source: { kind: "new_arrivals" }, limit: 8, headingBn: "", headingEn: "",
        columnsMobile: 2, columnsDesktop: 3, showPrice: true, showAddButton: true,
      };
    case "product_carousel":
      return {
        id, type, source: { kind: "new_arrivals" }, limit: 8, headingBn: "", headingEn: "",
        autoplay: false, showPrice: true, showAddButton: true,
      };
    case "countdown":
      return {
        id, type, target: { kind: "datetime", endsAt: "" }, headingBn: "অফার শেষ হতে বাকি", headingEn: "Offer ends in",
        expiredBehavior: "show_text", expiredTextBn: "অফারের সময় শেষ হয়ে গেছে", expiredTextEn: "This offer has ended",
      };
    case "trust_strip":
      return {
        id, type,
        items: (Object.keys(LANDING_TRUST_PRESETS) as TrustPresetKey[]).map((preset) => ({ preset, ...LANDING_TRUST_PRESETS[preset] })),
      };
    case "sticky_bar":
      return { id, type, textBn: "", textEn: "", target: "quick_order" };
  }
}
