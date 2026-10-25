// Landing render model — Agent 53. Pure: page + catalog -> ordered view model.
// The view model resolves product_offer product/variant references into the
// display + cart-snapshot fields the renderer needs. Prices are the
// catalog's integer poisha values, carried through unchanged (no recompute).
import type {
  BenefitItem, FaqItem, HowToOrderStep, LandingCatalogProduct, LandingPage, LandingSection,
} from "./types";

export interface ResolvedOffer {
  productId: string;
  productSlug: string;
  productTitleBn: string;
  productTitleEn: string;
  variantId: string;
  variantLabel: string;
  sku: string;
  /** Integer poisha — catalog value, unchanged. */
  pricePoisha: number;
  /** Integer poisha, nullable — catalog value, unchanged. */
  compareAtPoisha: number | null;
  stock: number;
  inStock: boolean;
  imageUrl: string | null;
}

/** One selectable variant of a quick-order product (catalog values, unchanged). */
export interface ResolvedOrderVariant {
  variantId: string;
  variantLabel: string;
  sku: string;
  /** Integer poisha — catalog value, unchanged. */
  pricePoisha: number;
  /** Integer poisha, nullable — catalog value, unchanged. */
  compareAtPoisha: number | null;
  stock: number;
  inStock: boolean;
  imageUrl: string | null;
}

/**
 * The product a quick_order section sells, with EVERY active variant so
 * the form can offer a real variant choice (ResolvedOffer collapses to
 * a single variant; the order form must not). `defaultVariantId` is the
 * section's pinned variant when it is still active, else the first
 * in-stock variant, else the first active one.
 */
export interface ResolvedOrderProduct {
  productId: string;
  productSlug: string;
  productTitleBn: string;
  productTitleEn: string;
  variants: ResolvedOrderVariant[];
  defaultVariantId: string;
}

export type LandingViewSection =
  | { kind: "hero"; id: string; titleBn: string; titleEn: string; subtitleBn: string; subtitleEn: string; imageUrl: string | null; ctaLabelBn: string; ctaLabelEn: string }
  | { kind: "product_offer"; id: string; offer: ResolvedOffer | null; discountNoteBn: string; discountNoteEn: string; showCountdown: boolean; countdownEndsAt: string | null }
  | { kind: "benefits"; id: string; headingBn: string; headingEn: string; items: BenefitItem[] }
  | { kind: "how_to_order"; id: string; headingBn: string; headingEn: string; steps: HowToOrderStep[] }
  | { kind: "faq"; id: string; headingBn: string; headingEn: string; items: FaqItem[] }
  | { kind: "order_form_note"; id: string; textBn: string; textEn: string }
  | { kind: "quick_order"; id: string; headingBn: string; headingEn: string; product: ResolvedOrderProduct | null }
  | { kind: "footer_note"; id: string; textBn: string; textEn: string };

export interface LandingViewModel {
  slug: string;
  titleBn: string;
  titleEn: string;
  status: LandingPage["status"];
  /** The first resolvable offer — the page-level buy target / tracking ref. */
  primaryOffer: ResolvedOffer | null;
  sections: LandingViewSection[];
}

export function resolveOffer(
  section: Extract<LandingSection, { type: "product_offer" }>,
  catalog: readonly LandingCatalogProduct[],
): ResolvedOffer | null {
  const product = catalog.find((p) => p.id === section.productId);
  if (!product) return null;
  const active = product.variants.filter((v) => v.isActive);
  const variant =
    (section.variantId ? active.find((v) => v.id === section.variantId) : undefined) ??
    active.find((v) => v.stock > 0) ??
    active[0];
  if (!variant) return null;
  return {
    productId: product.id,
    productSlug: product.slug,
    productTitleBn: product.title.bn,
    productTitleEn: product.title.en,
    variantId: variant.id,
    variantLabel: Object.values(variant.attributes).join(" / ") || "স্ট্যান্ডার্ড",
    sku: variant.sku,
    pricePoisha: variant.pricePoisha,
    compareAtPoisha: variant.compareAtPoisha,
    stock: variant.stock,
    inStock: variant.stock > 0,
    imageUrl: variant.imageUrl ?? product.images[0]?.url ?? null,
  };
}

/**
 * Resolve a quick_order section's product with its full active variant
 * list. Returns null when the product is gone or has no active variant
 * at all — the renderer then shows the same unavailable note the
 * product_offer section uses. A product whose variants are all out of
 * stock still resolves (the form renders but cannot be submitted).
 */
export function resolveOrderProduct(
  section: Extract<LandingSection, { type: "quick_order" }>,
  catalog: readonly LandingCatalogProduct[],
): ResolvedOrderProduct | null {
  const product = catalog.find((p) => p.id === section.productId);
  if (!product) return null;
  const active = product.variants.filter((v) => v.isActive);
  if (active.length === 0) return null;
  const variants: ResolvedOrderVariant[] = active.map((v) => ({
    variantId: v.id,
    variantLabel: Object.values(v.attributes).join(" / ") || "স্ট্যান্ডার্ড",
    sku: v.sku,
    pricePoisha: v.pricePoisha,
    compareAtPoisha: v.compareAtPoisha,
    stock: v.stock,
    inStock: v.stock > 0,
    imageUrl: v.imageUrl ?? product.images[0]?.url ?? null,
  }));
  const fallback =
    variants.find((v) => v.variantId === section.variantId) ??
    variants.find((v) => v.inStock) ??
    variants[0];
  return {
    productId: product.id,
    productSlug: product.slug,
    productTitleBn: product.title.bn,
    productTitleEn: product.title.en,
    variants,
    defaultVariantId: fallback.variantId,
  };
}

export function buildLandingViewModel(
  page: LandingPage,
  catalog: readonly LandingCatalogProduct[],
): LandingViewModel {
  const sections: LandingViewSection[] = page.sections.map((section): LandingViewSection => {
    switch (section.type) {
      case "hero":
        return { kind: "hero", id: section.id, titleBn: section.titleBn, titleEn: section.titleEn, subtitleBn: section.subtitleBn, subtitleEn: section.subtitleEn, imageUrl: section.imageUrl, ctaLabelBn: section.ctaLabelBn, ctaLabelEn: section.ctaLabelEn };
      case "product_offer":
        return { kind: "product_offer", id: section.id, offer: resolveOffer(section, catalog), discountNoteBn: section.discountNoteBn, discountNoteEn: section.discountNoteEn, showCountdown: section.showCountdown, countdownEndsAt: section.countdownEndsAt };
      case "benefits":
        return { kind: "benefits", id: section.id, headingBn: section.headingBn, headingEn: section.headingEn, items: section.items };
      case "how_to_order":
        return { kind: "how_to_order", id: section.id, headingBn: section.headingBn, headingEn: section.headingEn, steps: section.steps };
      case "faq":
        return { kind: "faq", id: section.id, headingBn: section.headingBn, headingEn: section.headingEn, items: section.items };
      case "order_form_note":
        return { kind: "order_form_note", id: section.id, textBn: section.textBn, textEn: section.textEn };
      case "quick_order":
        return { kind: "quick_order", id: section.id, headingBn: section.headingBn, headingEn: section.headingEn, product: resolveOrderProduct(section, catalog) };
      case "footer_note":
        return { kind: "footer_note", id: section.id, textBn: section.textBn, textEn: section.textEn };
    }
  });
  const primaryOffer =
    sections.find((s): s is Extract<LandingViewSection, { kind: "product_offer" }> => s.kind === "product_offer" && s.offer !== null)?.offer ?? null;
  return { slug: page.slug, titleBn: page.titleBn, titleEn: page.titleEn, status: page.status, primaryOffer, sections };
}
