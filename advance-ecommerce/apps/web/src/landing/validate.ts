// Landing page validation + status flow — Agent 53. Pure functions only.
import { z } from "zod";
import type { LandingCatalogProduct, LandingPage, LandingProductSource, LandingSection, LandingStatus } from "./types";

export const landingSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case");

const benefitItemSchema = z.object({ icon: z.string().max(8), textBn: z.string(), textEn: z.string() });
const faqItemSchema = z.object({ questionBn: z.string(), questionEn: z.string(), answerBn: z.string(), answerEn: z.string() });
const stepSchema = z.object({ textBn: z.string(), textEn: z.string() });
const galleryImageSchema = z.object({ url: z.string(), altBn: z.string(), altEn: z.string() });
const trustStripItemSchema = z.object({
  preset: z.enum(["cod", "home_delivery", "easy_return", "authentic", "support", "custom"]),
  icon: z.string().max(8), textBn: z.string(), textEn: z.string(),
});
/** Dynamic product source (doc 34 §3.4) — one spec shared by the
 *  grid and carousel section schemas. */
const landingProductSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual"), productIds: z.array(z.string()).max(100) }),
  z.object({ kind: z.literal("category"), slug: z.string() }),
  z.object({ kind: z.literal("tag"), tag: z.string() }),
  z.object({ kind: z.literal("best_sellers") }),
  z.object({ kind: z.literal("new_arrivals") }),
]);

/**
 * The FROZEN v1 section union — the original eight types (doc 34
 * §3.3 rule 1). Version-aware validation: a page stored in a v1
 * envelope validates under THIS union; the new block types are legal
 * only in v2 pages, which validate under `landingSectionSchema`
 * below. Writers write v2 only, so the API input schema is the v2
 * one; the v1 schema stays exported (and used by
 * landingPageInputSchemaV1) so the version matrix remains checkable
 * and a rollback build still parses every v1 page ever written.
 *
 * NOTE: no `z.ZodType<...>` annotation here on purpose — the v2
 * union below spreads this union's `.options`, which exists only on
 * the concrete ZodDiscriminatedUnion type (the annotation erases
 * it). The v1 output is a strict subset of LandingSection by
 * construction.
 */
export const landingSectionSchemaV1 = z.discriminatedUnion("type", [
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

/**
 * The v2 section union (§3.3): every v1 member plus the doc-34 block
 * libraries. This is the union the API input schema validates
 * against — writers write v2 envelopes only.
 */
export const landingSectionSchema: z.ZodType<LandingSection> = z.discriminatedUnion("type", [
  ...landingSectionSchemaV1.options,
  // Doc 34 L3 block library II (v2 union additions, §3.3).
  z.object({
    id: z.string().min(1), type: z.literal("reviews"),
    productId: z.string(), usePrimaryOffer: z.boolean(),
    limit: z.number().int().min(1).max(20), minRating: z.number().int().min(1).max(5),
  }),
  z.object({
    id: z.string().min(1), type: z.literal("gallery"),
    headingBn: z.string(), headingEn: z.string(),
    images: z.array(galleryImageSchema).max(24), layout: z.enum(["grid", "carousel"]),
  }),
  z.object({
    id: z.string().min(1), type: z.literal("image_banner"),
    imageUrl: z.string(), altBn: z.string(), altEn: z.string(),
    linkUrl: z.string().nullable(), headingBn: z.string(), headingEn: z.string(),
  }),
  z.object({
    id: z.string().min(1), type: z.literal("video"),
    provider: z.literal("youtube"), videoId: z.string(),
    headingBn: z.string(), headingEn: z.string(),
  }),
  z.object({ id: z.string().min(1), type: z.literal("rich_text"), bodyBn: z.string(), bodyEn: z.string() }),
  z.object({
    id: z.string().min(1), type: z.literal("bundle_offer"),
    productId: z.string(), variantId: z.string().nullable(),
    headingBn: z.string(), headingEn: z.string(), ctaToOrderForm: z.boolean(),
  }),
  // Doc 34 L2 block library I (v2 union additions, §3.3).
  z.object({
    id: z.string().min(1), type: z.literal("product_grid"),
    source: landingProductSourceSchema,
    limit: z.number().int().min(4).max(24),
    headingBn: z.string(), headingEn: z.string(),
    columnsMobile: z.union([z.literal(1), z.literal(2)]),
    columnsDesktop: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    showPrice: z.boolean(), showAddButton: z.boolean(),
  }),
  z.object({
    id: z.string().min(1), type: z.literal("product_carousel"),
    source: landingProductSourceSchema,
    limit: z.number().int().min(4).max(24),
    headingBn: z.string(), headingEn: z.string(),
    autoplay: z.boolean(), showPrice: z.boolean(), showAddButton: z.boolean(),
  }),
  z.object({
    id: z.string().min(1), type: z.literal("countdown"),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("datetime"), endsAt: z.string() }),
      z.object({ kind: z.literal("flash_sale") }),
    ]),
    headingBn: z.string(), headingEn: z.string(),
    expiredBehavior: z.enum(["hide", "show_text"]),
    expiredTextBn: z.string(), expiredTextEn: z.string(),
  }),
  z.object({
    id: z.string().min(1), type: z.literal("trust_strip"),
    items: z.array(trustStripItemSchema).max(12),
  }),
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

/**
 * The v1 page input schema (§3.3 rule 1): identical envelope shape,
 * but sections validate under the FROZEN v1 union — the new block
 * types are rejected here, which is exactly the guarantee that a v1
 * page can never contain them. Kept for the version matrix (tests /
 * rollback tooling); the live API writes v2 and uses the schema
 * above.
 */
export const landingPageInputSchemaV1 = z.object({
  slug: landingSlugSchema,
  titleBn: z.string().min(1),
  titleEn: z.string().min(1),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  sections: z.array(landingSectionSchemaV1).min(1),
});

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
 *
 * Dynamic sources (doc 34 §3.4, L2): a grid/carousel `manual` source's
 * ids must resolve in `catalog` like any other product ref. Category
 * and tag sources are checked for EXISTENCE through `collections` —
 * the caller-resolved products per section id (resolveLandingCollections;
 * a plain record, matching LandingBlockExtras, so it serializes into
 * the builder): when the caller provides a resolution and it is
 * empty, the source currently names nothing sellable and publish is
 * refused; when no resolution is provided the check is skipped and
 * the server-side publish validation is authoritative.
 * best_sellers / new_arrivals validate as "source legal" only — their
 * contents are real aggregates that vary over time by design.
 */
export function validateLandingPage(
  page: Pick<LandingPage, "slug" | "titleBn" | "titleEn" | "sections">,
  catalog: readonly LandingCatalogProduct[],
  otherSlugs: readonly string[] = [],
  collections?: Readonly<Record<string, readonly LandingCatalogProduct[] | null | undefined>>,
): LandingValidationResult {
  const errors: LandingValidationError[] = [];
  const err = (code: string, messageBn: string, messageEn: string, sectionId?: string) =>
    errors.push({ code, messageBn, messageEn, sectionId });

  const validateSource = (source: LandingProductSource, sectionId: string) => {
    switch (source.kind) {
      case "manual": {
        if (source.productIds.length === 0) {
          err("SOURCE_PRODUCTS_REQUIRED", "পণ্যের তালিকার জন্য অন্তত একটি পণ্য বেছে নিন।", "Pick at least one product for the manual source.", sectionId);
          break;
        }
        const missing = source.productIds.filter((id) => !catalog.some((p) => p.id === id));
        if (missing.length > 0) {
          err("PRODUCT_NOT_FOUND", "তালিকার একটি পণ্য ক্যাটালগে পাওয়া যায়নি।", "A product in the manual source does not resolve in the catalog.", sectionId);
        }
        break;
      }
      case "category": {
        if (!source.slug.trim()) {
          err("SOURCE_SLUG_REQUIRED", "ক্যাটাগরির স্লাগ আবশ্যক।", "The category source needs a category slug.", sectionId);
        } else if (collections && (collections[sectionId] ?? []).length === 0) {
          err("SOURCE_RESOLVES_EMPTY", "এই ক্যাটাগরিতে এখন কোনো সক্রিয় পণ্য নেই — অন্য ক্যাটাগরি বেছে নিন।", "This category currently has no active products — pick another category.", sectionId);
        }
        break;
      }
      case "tag": {
        if (!source.tag.trim()) {
          err("SOURCE_TAG_REQUIRED", "ট্যাগ আবশ্যক।", "The tag source needs a tag.", sectionId);
        } else if (collections && (collections[sectionId] ?? []).length === 0) {
          err("SOURCE_RESOLVES_EMPTY", "এই ট্যাগে এখন কোনো সক্রিয় পণ্য নেই — অন্য ট্যাগ বেছে নিন।", "This tag currently has no active products — pick another tag.", sectionId);
        }
        break;
      }
      case "best_sellers":
      case "new_arrivals":
        // Source-legal only (§3.4): contents are live aggregates.
        break;
    }
  };

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
      case "reviews": {
        // Bound to the primary offer → nothing to resolve here (the
        // offer itself is validated above; a page without a
        // resolvable offer simply renders no reviews). An explicit
        // product must resolve like every other product ref.
        if (!section.usePrimaryOffer) {
          const product = catalog.find((p) => p.id === section.productId);
          if (!section.productId || !product) {
            err("PRODUCT_NOT_FOUND", "রিভিউ ব্লকের পণ্যটি ক্যাটালগে পাওয়া যায়নি।", "Reviews product does not resolve in the catalog.", section.id);
          }
        }
        break;
      }
      case "gallery":
        if (section.images.length === 0 || section.images.some((i) => !i.url.trim())) {
          err("GALLERY_IMAGE_REQUIRED", "গ্যালারির প্রতিটি ছবির URL আবশ্যক।", "Every gallery image needs a URL.", section.id);
        }
        break;
      case "image_banner":
        if (!section.imageUrl.trim()) {
          err("BANNER_IMAGE_REQUIRED", "ব্যানারের ছবির URL আবশ্যক।", "The banner image URL is required.", section.id);
        }
        if (section.linkUrl && !/^(https?:\/\/|\/)/.test(section.linkUrl.trim())) {
          err("BANNER_LINK_INVALID", "ব্যানারের লিংক অবশ্যই https:// বা / দিয়ে শুরু হতে হবে।", "Banner link must start with https:// or /.", section.id);
        }
        break;
      case "video":
        if (!/^[A-Za-z0-9_-]{6,20}$/.test(section.videoId.trim())) {
          err("VIDEO_ID_INVALID", "YouTube ভিডিও আইডি সঠিক নয়।", "The YouTube video id is not valid.", section.id);
        }
        break;
      case "rich_text":
        if (!section.bodyBn.trim()) {
          err("RICH_TEXT_REQUIRED", "বিস্তারিত লেখার বাংলা অংশ আবশ্যক।", "The rich text block needs its Bangla body.", section.id);
        }
        break;
      case "bundle_offer": {
        // Same linkage rules as product_offer. Whether the product
        // truly IS a bundle is a render-time fact (BundleComponent
        // rows); a non-bundle simply renders nothing (§3.4 honesty).
        const product = catalog.find((p) => p.id === section.productId);
        if (!section.productId || !product) {
          err("PRODUCT_NOT_FOUND", "বান্ডলের পণ্যটি ক্যাটালগে পাওয়া যায়নি।", "Bundle product does not resolve in the catalog.", section.id);
        } else if (section.variantId && !product.variants.some((v) => v.id === section.variantId)) {
          err("VARIANT_NOT_FOUND", "বান্ডলের ভেরিয়েন্টটি ওই পণ্যে পাওয়া যায়নি।", "Bundle variant does not resolve on that product.", section.id);
        }
        break;
      }
      case "product_grid":
      case "product_carousel": {
        if (!Number.isInteger(section.limit) || section.limit < 4 || section.limit > 24) {
          err("LIMIT_OUT_OF_RANGE", "পণ্যের সীমা ৪ থেকে ২৪-এর মধ্যে হতে হবে।", "The product limit must be between 4 and 24.", section.id);
        }
        validateSource(section.source, section.id);
        break;
      }
      case "countdown": {
        if (section.target.kind === "datetime" && Number.isNaN(Date.parse(section.target.endsAt))) {
          err("COUNTDOWN_INVALID", "কাউন্টডাউনের তারিখ সঠিক নয়।", "Countdown end date is invalid.", section.id);
        }
        // flash_sale target: nothing stored to parse — the end is
        // whatever sale is live at render (§3.4 source-legal rule).
        if (section.expiredBehavior === "show_text" && !section.expiredTextBn.trim()) {
          err("EXPIRED_TEXT_REQUIRED", "মেয়াদ শেষের বাংলা লেখা আবশ্যক।", "The expired-state Bangla text is required.", section.id);
        }
        break;
      }
      case "trust_strip":
        if (section.items.length === 0 || section.items.some((i) => !i.textBn.trim())) {
          err("TRUST_TEXT_REQUIRED", "প্রতিটি আস্থার আইটেমের বাংলা লেখা আবশ্যক।", "Every trust item needs Bangla text.", section.id);
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
  collections?: Readonly<Record<string, readonly LandingCatalogProduct[] | null | undefined>>,
): LandingTransitionResult {
  if (!canTransitionLanding(page.status, to)) {
    return { ok: false, code: "INVALID_TRANSITION", messageBn: `অবস্থা ${page.status} থেকে ${to}-তে যাওয়া যায় না।`, messageEn: `Cannot move from ${page.status} to ${to}.` };
  }
  if (to === "PUBLISHED") {
    const validation = validateLandingPage(page, catalog, otherSlugs, collections);
    if (!validation.ok) {
      return { ok: false, code: "VALIDATION_FAILED", messageBn: "যাচাই ব্যর্থ — প্রকাশ করা যাচ্ছে না।", messageEn: "Validation failed — cannot publish.", validation };
    }
  }
  return { ok: true, page: { ...page, status: to, updatedAt: new Date().toISOString() } };
}
