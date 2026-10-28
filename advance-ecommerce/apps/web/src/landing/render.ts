// Landing render model — Agent 53. Pure: page + catalog -> ordered view model.
// The view model resolves product_offer product/variant references into the
// display + cart-snapshot fields the renderer needs. Prices are the
// catalog's integer poisha values, carried through unchanged (no recompute).
import type {
  BenefitItem, FaqItem, GalleryImage, HowToOrderStep, LandingCatalogProduct, LandingPage, LandingSection, TrustStripItem,
} from "./types";

export interface ResolvedOffer {
  productId: string;
  productSlug: string;
  productTitleBn: string;
  productTitleEn: string;
  variantId: string;
  /** Joined variant attributes; "" when the variant carries none —
   *  renderers substitute the landing dictionary's standardVariant
   *  label for the empty case (doc 34 L1: the fallback is chrome, so
   *  it is locale-picked at render like every other chrome string). */
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
  /** Joined variant attributes; "" = none (see ResolvedOffer). */
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

/** One APPROVED review as the block shows it (doc 34 L3). Public
 *  shape mirrored from src/reviews/store.ts PublicReview — author
 *  name only, phone never crosses into a view model (§0.7). */
export interface ResolvedReviewItem {
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
  verifiedPurchase: boolean;
  images: string[];
}

/** Reviews block data: the product's TRUE approved aggregate
 *  (average/count over ALL approved reviews) + the listed cards
 *  (newest first, owner's minRating filter applied to the list
 *  only). Null in the view model = the block renders nothing. */
export interface ResolvedReviews {
  productId: string;
  average: number | null;
  count: number;
  items: ResolvedReviewItem[];
}

/** One line of a bundle's fixed contents (the bundle-builder read
 *  model's shape — quantities identical to /bundle-builder). */
export interface ResolvedBundleComponent {
  titleBn: string;
  titleEn: string;
  productSlug: string | null;
  variantLabel: string | null;
  quantity: number;
  unitPricePoisha: number | null;
  lineTotalPoisha: number | null;
}

/** The async half of a bundle block, resolved server-side
 *  (src/landing/resolve-extras.ts): BundleComponent rows live
 *  outside the landing catalog shape, so they cannot ride the
 *  synchronous catalog array. render.ts combines this with the
 *  offer resolver's live price to form ResolvedBundle. */
export interface BundleBlockData {
  components: ResolvedBundleComponent[];
  /** Σ component line totals; null when any price is unknown. */
  componentsTotalPoisha: number | null;
  available: boolean;
}

export interface ResolvedBundle {
  offer: ResolvedOffer;
  components: ResolvedBundleComponent[];
  componentsTotalPoisha: number | null;
  /** componentsTotal − the RESOLVED variant's live price, only
   *  when positive and the total is known — else null (no savings
   *  claim is rendered, the bundle-builder page's own rule). */
  savingsPoisha: number | null;
  available: boolean;
}

/**
 * Server-resolved block data that cannot come from the catalog
 * array (doc 34 L3): reviews read the Review table, bundle contents
 * read BundleComponent rows. Keyed by section id; plain records so
 * the admin page can serialize them into the builder as props.
 * Absent entry = unresolved = the block renders nothing.
 * Populated by src/landing/resolve-extras.ts on server surfaces;
 * the pure builder preview resolves these blocks only for sections
 * the server pass covered (saved pages), exactly like a product
 * ref outside the builder's catalog list behaves today.
 */
export interface LandingBlockExtras {
  reviews?: Record<string, ResolvedReviews | null>;
  bundles?: Record<string, BundleBlockData | null>;
  /** L2 dynamic collections: the LIVE products each product_grid /
   *  product_carousel section's source resolved to (via
   *  resolveLandingCollections over LandingCatalogQueries — public
   *  instance on /lp, admin instance in preview/validation). The
   *  view model turns them into cards with the same variant pick as
   *  the offer resolver; an absent/empty entry renders nothing. */
  collections?: Record<string, LandingCatalogProduct[] | null>;
  /** L2 countdown: the live flash sale's endsAt (ISO) when a sale
   *  is live, else null — resolved server-side via getLiveFlashSale.
   *  Countdown sections targeting the flash sale read their end
   *  from here; null/absent = no real end = the block hides (§0.7). */
  flashSaleEndsAt?: string | null;
}

export type LandingViewSection =
  | { kind: "hero"; id: string; titleBn: string; titleEn: string; subtitleBn: string; subtitleEn: string; imageUrl: string | null; ctaLabelBn: string; ctaLabelEn: string }
  | { kind: "product_offer"; id: string; offer: ResolvedOffer | null; discountNoteBn: string; discountNoteEn: string; showCountdown: boolean; countdownEndsAt: string | null }
  | { kind: "benefits"; id: string; headingBn: string; headingEn: string; items: BenefitItem[] }
  | { kind: "how_to_order"; id: string; headingBn: string; headingEn: string; steps: HowToOrderStep[] }
  | { kind: "faq"; id: string; headingBn: string; headingEn: string; items: FaqItem[] }
  | { kind: "order_form_note"; id: string; textBn: string; textEn: string }
  | { kind: "quick_order"; id: string; headingBn: string; headingEn: string; product: ResolvedOrderProduct | null }
  | { kind: "footer_note"; id: string; textBn: string; textEn: string }
  | { kind: "reviews"; id: string; reviews: ResolvedReviews | null }
  | { kind: "gallery"; id: string; headingBn: string; headingEn: string; images: GalleryImage[]; layout: "grid" | "carousel" }
  | { kind: "image_banner"; id: string; imageUrl: string; altBn: string; altEn: string; linkUrl: string | null; headingBn: string; headingEn: string }
  | { kind: "video"; id: string; videoId: string; headingBn: string; headingEn: string }
  | { kind: "rich_text"; id: string; bodyBn: string; bodyEn: string }
  | { kind: "bundle_offer"; id: string; headingBn: string; headingEn: string; ctaToOrderForm: boolean; bundle: ResolvedBundle | null }
  | { kind: "product_grid"; id: string; headingBn: string; headingEn: string; cards: ResolvedOffer[]; columnsMobile: 1 | 2; columnsDesktop: 2 | 3 | 4; showPrice: boolean; showAddButton: boolean }
  | { kind: "product_carousel"; id: string; headingBn: string; headingEn: string; cards: ResolvedOffer[]; autoplay: boolean; showPrice: boolean; showAddButton: boolean }
  | { kind: "countdown"; id: string; headingBn: string; headingEn: string; endsAt: string | null; expiredBehavior: "hide" | "show_text"; expiredTextBn: string; expiredTextEn: string }
  | { kind: "trust_strip"; id: string; items: TrustStripItem[] };

export interface LandingViewModel {
  slug: string;
  titleBn: string;
  titleEn: string;
  status: LandingPage["status"];
  /** The first resolvable offer — the page-level buy target / tracking ref. */
  primaryOffer: ResolvedOffer | null;
  sections: LandingViewSection[];
}

/** The one variant-pick rule every card-shaped resolution shares:
 *  the pinned variant when still active, else the first in-stock
 *  variant, else the first active one; null when the product has no
 *  active variant at all. */
function toResolvedOffer(
  product: LandingCatalogProduct,
  pinnedVariantId: string | null,
): ResolvedOffer | null {
  const active = product.variants.filter((v) => v.isActive);
  const variant =
    (pinnedVariantId ? active.find((v) => v.id === pinnedVariantId) : undefined) ??
    active.find((v) => v.stock > 0) ??
    active[0];
  if (!variant) return null;
  return {
    productId: product.id,
    productSlug: product.slug,
    productTitleBn: product.title.bn,
    productTitleEn: product.title.en,
    variantId: variant.id,
    variantLabel: Object.values(variant.attributes).join(" / "),
    sku: variant.sku,
    pricePoisha: variant.pricePoisha,
    compareAtPoisha: variant.compareAtPoisha,
    stock: variant.stock,
    inStock: variant.stock > 0,
    imageUrl: variant.imageUrl ?? product.images[0]?.url ?? null,
  };
}

export function resolveOffer(
  section: Extract<LandingSection, { type: "product_offer" }>,
  catalog: readonly LandingCatalogProduct[],
): ResolvedOffer | null {
  const product = catalog.find((p) => p.id === section.productId);
  if (!product) return null;
  return toResolvedOffer(product, section.variantId);
}

/**
 * Resolve ONE collection product (grid/carousel cell) into its card
 * shape — the offer pick with no pinned variant. A product whose
 * variants are all out of stock still resolves (its cell shows the
 * out-of-stock state, per the L2 exit rule); a product with no
 * active variant returns null and drops out of the block silently.
 */
export function resolveCardProduct(product: LandingCatalogProduct): ResolvedOffer | null {
  return toResolvedOffer(product, null);
}

/** Collection products → cards: drop unresolvable products, cap at
 *  the block's limit (the resolver already bounded the list; the
 *  cap here keeps hand-fed extras honest too). */
function resolveCollectionCards(
  products: readonly LandingCatalogProduct[] | null | undefined,
  limit: number,
): ResolvedOffer[] {
  if (!products) return [];
  return products
    .map(resolveCardProduct)
    .filter((c): c is ResolvedOffer => c !== null)
    .slice(0, limit);
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
    variantLabel: Object.values(v.attributes).join(" / "),
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
  extras?: LandingBlockExtras,
): LandingViewModel {
  const sections: LandingViewSection[] = page.sections
    .map((section): LandingViewSection | null => {
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
        case "reviews":
          return { kind: "reviews", id: section.id, reviews: extras?.reviews?.[section.id] ?? null };
        case "gallery":
          return { kind: "gallery", id: section.id, headingBn: section.headingBn, headingEn: section.headingEn, images: section.images, layout: section.layout };
        case "image_banner":
          return { kind: "image_banner", id: section.id, imageUrl: section.imageUrl, altBn: section.altBn, altEn: section.altEn, linkUrl: section.linkUrl, headingBn: section.headingBn, headingEn: section.headingEn };
        case "video":
          return { kind: "video", id: section.id, videoId: section.videoId, headingBn: section.headingBn, headingEn: section.headingEn };
        case "rich_text":
          return { kind: "rich_text", id: section.id, bodyBn: section.bodyBn, bodyEn: section.bodyEn };
        case "bundle_offer": {
          // Price/variant/stock resolve live through the SAME offer
          // resolver product_offer uses (the section is ref-shaped
          // identically); contents ride the async extras. Either
          // half missing → bundle null → the block renders nothing
          // (a non-bundle or unavailable bundle is never dressed up
          // as one).
          const offer = resolveOffer(
            {
              id: section.id, type: "product_offer", productId: section.productId, variantId: section.variantId,
              discountNoteBn: "", discountNoteEn: "", showCountdown: false, countdownEndsAt: null,
            },
            catalog,
          );
          const data = extras?.bundles?.[section.id] ?? null;
          const bundle: ResolvedBundle | null =
            offer && data
              ? {
                  offer,
                  components: data.components,
                  componentsTotalPoisha: data.componentsTotalPoisha,
                  savingsPoisha:
                    data.componentsTotalPoisha !== null && data.componentsTotalPoisha > offer.pricePoisha
                      ? data.componentsTotalPoisha - offer.pricePoisha
                      : null,
                  available: data.available,
                }
              : null;
          return { kind: "bundle_offer", id: section.id, headingBn: section.headingBn, headingEn: section.headingEn, ctaToOrderForm: section.ctaToOrderForm, bundle };
        }
        case "product_grid":
          return {
            kind: "product_grid", id: section.id, headingBn: section.headingBn, headingEn: section.headingEn,
            cards: resolveCollectionCards(extras?.collections?.[section.id], section.limit),
            columnsMobile: section.columnsMobile, columnsDesktop: section.columnsDesktop,
            showPrice: section.showPrice, showAddButton: section.showAddButton,
          };
        case "product_carousel":
          return {
            kind: "product_carousel", id: section.id, headingBn: section.headingBn, headingEn: section.headingEn,
            cards: resolveCollectionCards(extras?.collections?.[section.id], section.limit),
            autoplay: section.autoplay, showPrice: section.showPrice, showAddButton: section.showAddButton,
          };
        case "countdown":
          return {
            kind: "countdown", id: section.id, headingBn: section.headingBn, headingEn: section.headingEn,
            // Explicit target: the stored datetime. Flash-sale
            // target: the live sale's end from the server extras —
            // null when no sale is live, and the block then renders
            // nothing (never an invented deadline, §0.7).
            endsAt: section.target.kind === "datetime" ? section.target.endsAt : extras?.flashSaleEndsAt ?? null,
            expiredBehavior: section.expiredBehavior, expiredTextBn: section.expiredTextBn, expiredTextEn: section.expiredTextEn,
          };
        case "trust_strip":
          return { kind: "trust_strip", id: section.id, items: section.items };
        default:
          // Forward-compat (doc 34 §3.3 rule 3): a section type this
          // deploy does not know — a newer page read by an older
          // build after a rollback — is SKIPPED silently; the rest of
          // the page renders, nothing crashes.
          return null;
      }
    })
    .filter((s): s is LandingViewSection => s !== null);
  const primaryOffer =
    sections.find((s): s is Extract<LandingViewSection, { kind: "product_offer" }> => s.kind === "product_offer" && s.offer !== null)?.offer ?? null;
  return { slug: page.slug, titleBn: page.titleBn, titleEn: page.titleEn, status: page.status, primaryOffer, sections };
}
