/**
 * Theme slot contracts — doc 25 §1.4 (waves S3a + S3b).
 *
 * The component contracts for the layout slots a theme package may
 * fill. Each slot's props are EXACTLY the props the platform passes
 * at the slot's mount point today — a package re-implements the
 * component, never the data flow:
 *
 * - Header / Footer mount inside the client storefront shell
 *   (app/storefront-shell.tsx). The shell owns the pathname gating
 *   and the client-side fetches (category tree, CMS menus) and passes
 *   their results down — so the contracts are the SiteHeader /
 *   SiteFooter prop types themselves.
 * - HomeSections mounts in app/page.tsx, which keeps ALL data
 *   fetching (catalog, CMS hero slides, approved reviews, hero
 *   experiment state) and passes the loaded objects in.
 * - ProductCard (S3b) is the single shared card
 *   (src/catalog/ProductCard.tsx): its contract is its current props.
 *   Consumers resolve it through ThemedProductCard (client wrapper)
 *   or the server registry.
 * - ShopChrome (S3b) is the /shop sidebar + toolbar composition.
 *   ShopBrowser keeps ALL state, fetching and URL logic and passes
 *   presentational values + href-builder callbacks + the results
 *   block (children) in; the chrome only arranges markup.
 * - PdpComposition (S3b) is the PDP arrangement (gallery + buy-box
 *   grid + section order). The PDP page keeps ALL data fetching and
 *   every derived display value; the composition only places them.
 * - CartPage (S3b) is the whole /cart client composition: its
 *   contract is CartPageClient's current props, resolved server-side
 *   by app/(store)/cart/page.tsx.
 * - CartDrawer (S3b) is the slide-in cart a package may provide.
 *   Aurora registers an explicit null component (the header cart
 *   links to /cart today); the contract exists so a package (S4's
 *   Ghorer) can plug a real drawer into the same seam.
 * - CheckoutSkin (S3b) is NOT a component: it is the record of the
 *   checkout page's styling constants, so a package can re-skin the
 *   checkout without touching its logic (see the CheckoutSkin type).
 *
 * This module is types-only (plus no runtime code at all), so server
 * components, client components and both slot registries can share
 * the contracts without pulling any component into the wrong bundle.
 * Slot COMPONENTS live in the registries: src/themes/slot-registry
 * (server: Header + Footer + HomeSections + ProductCard +
 * PdpComposition + CartPage) and the client-safe registries
 * (client-slot-registry: Header + Footer + CartDrawer;
 * client-card-registry: ProductCard; client-shop-registry:
 * ShopChrome — split so leaf consumers never drag the shop chrome
 * or drawer code into their bundles; HomeSections/PdpComposition
 * render async server sections that must never enter the client
 * bundle).
 */
import type { ComponentType, ReactNode } from "react";
import type { SiteFooterProps, SiteHeaderProps } from "@/storefront-shell";
import type { Category, FaqItem, PublicProduct, SizeChart } from "@/catalog/types";
import type { HeroSlide } from "@/cms/site-content-types";
import type { HomepageReview } from "@/reviews/store";
import type {
  BundleComponentEntry,
  DigitalFileEntry,
  PreorderEntry,
  ProductTypeValue,
} from "@/catalog/product-type-contract";
import type { PublicBrand } from "@/catalog/public-brands";
import type { WeightedVariantInfo } from "@/business-modules/grocery-pricing";
import type { PdpPackSizeChart } from "@/business-modules/fashion-wiring";
import type { BoxPdpData } from "@/boxes/service";
import type { PodPdpNote } from "@/pod/customisation";
import type { CourseOutline } from "@/courses/content";
import type { RecentlyViewedEntry } from "@/storefront-ux/types";
import type { WeightedVariantAnnotation } from "@/cart/components/CartPageClient";

/* ------------------------------------------------------------------ */
/* Header / Footer — mounted by the client storefront shell           */
/* ------------------------------------------------------------------ */

/** The exact props the shell passes SiteHeader today. */
export type ThemeHeaderProps = SiteHeaderProps;
export type ThemeHeaderSlot = ComponentType<ThemeHeaderProps>;

/** The exact props the shell passes SiteFooter today. */
export type ThemeFooterProps = SiteFooterProps;
export type ThemeFooterSlot = ComponentType<ThemeFooterProps>;

/* ------------------------------------------------------------------ */
/* HomeSections — mounted by app/page.tsx                             */
/* ------------------------------------------------------------------ */

/**
 * The data the home page loads, passed through unchanged. The page
 * keeps fetching; the slot only composes. `heroStats` is the page's
 * pre-rendered stat row (built from `categories` with the animated
 * CountUp) because it is shared by both hero variants the
 * composition chooses between — the composition places it, the page
 * builds it, exactly as the inline JSX did before the move.
 */
export interface HomeSectionsProps {
  /** ACTIVE public products (page's `listActivePublicProducts(8)`). */
  products: PublicProduct[];
  /** Live categories with product counts (`listCategories()`). */
  categories: Category[];
  /** Active CMS hero slides; [] renders the static hero. */
  heroSlides: HeroSlide[];
  /** Real approved homepage reviews; [] renders no section. */
  customerReviews: HomepageReview[];
  /** Marketing-mechanics master flag (gates VisitorIdBootstrap). */
  mechanicsOn: boolean;
  /** Whether a hero A/B experiment could apply to this render. */
  experimentActive: boolean;
  /** Pre-rendered hero stat row, or null while the catalog is empty. */
  heroStats: ReactNode;
}

export type ThemeHomeSectionsSlot = ComponentType<HomeSectionsProps>;

/* ------------------------------------------------------------------ */
/* ProductCard — consumed across home / shop / search / PDP rails     */
/* ------------------------------------------------------------------ */

/** The exact props src/catalog/ProductCard.tsx takes today. */
export interface ThemeProductCardProps {
  product: PublicProduct;
}

export type ThemeProductCardSlot = ComponentType<ThemeProductCardProps>;

/* ------------------------------------------------------------------ */
/* ShopChrome — mounted by ShopBrowser (client, /shop)                */
/* ------------------------------------------------------------------ */

/** Structural subset of ShopBrowser's category API node — the only
 *  fields the sidebar markup reads. */
export interface ShopChromeCategoryOption {
  slug: string;
  name: { bn: string; en: string };
  productCount: number;
}

/** One attribute facet group, as derived by ShopBrowser from the
 *  attribute-set library scoped to the facet-base products. */
export interface ShopChromeAttrFacet {
  key: string;
  labelBn: string;
  labelEn: string;
  values: string[];
}

/** The shop URL-state shape (ShopBrowser's ShopState, mirrored here
 *  so the contract carries no import from the page). `attr` entries
 *  are raw "key:value" strings, one per selected attribute value. */
export interface ShopChromeFilterState {
  category?: string;
  brand?: string;
  sort?: string;
  min?: string;
  max?: string;
  instock?: string;
  q?: string;
  rating?: string;
  attr: string[];
}

export interface ShopChromeAttrPair {
  key: string;
  value: string;
}

/**
 * Everything the sidebar + toolbar composition renders, as plain
 * presentational inputs. ShopBrowser (the state owner) derives every
 * value and href exactly as it did when the JSX was inline; the
 * chrome's only job is arrangement. The filter panel appears TWICE
 * in the output (desktop sidebar card + mobile drawer), so it is
 * built inside the chrome from these props — not passed as a node.
 * The results block (loading skeletons / empty state / product grid)
 * stays ShopBrowser's and arrives as `children`.
 */
export interface ShopChromeProps {
  /* Breadcrumb + heading row */
  /** Active category's Bangla name, or null on the plain shop view. */
  breadcrumbCategoryLabel: string | null;
  heading: string;
  /** Exact catalogue total, or null before the first response. */
  displayTotal: number | null;
  /** Any filter or search is active (drives the count suffix and
   *  the mobile drawer's clear link). */
  filtersApplied: boolean;
  /* Toolbar */
  /** displayTotal ?? 0 — the mobile drawer's live count. */
  resultCount: number;
  /** "/shop" while filters are applied, else undefined (no clear link). */
  clearHref?: string;
  /** Current sort value (ShopBrowser's parsed SortOption). */
  sort: string;
  /** Fired with the newly selected sort value; ShopBrowser pushes
   *  the same `sort` param it always did. */
  onSortChange: (value: string) => void;
  /** Active filter chips, hrefs already resolved by ShopBrowser. */
  chips: ReadonlyArray<{ key: string; label: string; href: string }>;
  /** aria-busy for the results section (loading or refreshing). */
  busy: boolean;
  /* Filter panel inputs (rendered in the sidebar AND the drawer) */
  categories: ReadonlyArray<ShopChromeCategoryOption>;
  brands: ReadonlyArray<PublicBrand>;
  attrFacets: ReadonlyArray<ShopChromeAttrFacet>;
  /** The current URL state (`current` in ShopBrowser). */
  filterState: ShopChromeFilterState;
  activeCategorySlug?: string;
  activeBrand?: string;
  hasPriceFilter: boolean;
  minPoisha?: number;
  maxPoisha?: number;
  ratingMin?: number;
  inStockOnly: boolean;
  /** ShopBrowser's buildHref, passed through under its own name so
   *  the moved panel JSX calls it exactly as before. */
  buildHref: (
    current: ShopChromeFilterState,
    overrides: Partial<ShopChromeFilterState>,
  ) => string;
  /** ShopBrowser's toggleAttr (attr pair → toggled href). */
  toggleAttr: (state: ShopChromeFilterState, pair: ShopChromeAttrPair) => string;
  /** ShopBrowser's pairToParam ("key:value"). */
  pairToParam: (pair: ShopChromeAttrPair) => string;
  /* Results block (loading / empty / grid), built by ShopBrowser. */
  children: ReactNode;
}

export type ThemeShopChromeSlot = ComponentType<ShopChromeProps>;

/* ------------------------------------------------------------------ */
/* PdpComposition — mounted by app/(store)/product/[slug]/page.tsx   */
/* ------------------------------------------------------------------ */

/**
 * The PDP arrangement's inputs: the public product plus EVERY derived
 * display value the page computes today (prices, discount, bundle and
 * preorder derivations, weighted/box/pod/course extras, spec rows,
 * FAQ items — all computed by the page, in the page, exactly as
 * before). The composition renders them in the page's current order
 * and markup; it derives nothing and fetches nothing.
 */
export interface PdpCompositionProps {
  product: PublicProduct;
  productType: ProductTypeValue;
  digitalFiles: DigitalFileEntry[];
  bundleComponents: BundleComponentEntry[];
  preorder: PreorderEntry | null;
  /** The preorder expected-delivery date, pre-formatted (bn-BD) by
   *  the page, or null when unset/unparseable. */
  preorderExpectedLabel: string | null;
  priceOnRequest: boolean;
  minPrice: number;
  maxPrice: number;
  hasPriceRange: boolean;
  /** Discount display verdict (sale-window aware, page-computed). */
  showDiscount: boolean;
  bestDiscount: { price: number; compare: number } | null;
  discountPct: number;
  displayInStock: boolean;
  bundleUnavailable: boolean;
  /** Component-derived bundle stock, when the service provided it. */
  bundleCount: number | null;
  bundleComponentsTotal: number | null;
  /** Honest-social-proof low-stock band threshold, or null (flag off). */
  lowStockThreshold: number | null;
  /** 360° spin viewer eligibility (flag + >= 6 gallery frames). */
  spinEnabled: boolean;
  /** Age-gate minimum age for this product's category, or null. */
  ageMinAge: number | null;
  weightedInfos: WeightedVariantInfo[];
  boxPdpData: BoxPdpData | null;
  podPdpNote: PodPdpNote | null;
  courseOutline: CourseOutline | null;
  displaySizeChart: SizeChart | null;
  packSizeChart: PdpPackSizeChart | null;
  specRows: Array<{ key: string; values: string[] }>;
  faqItems: FaqItem[];
  outOfStockVariants: Array<{ variantId: string; label: string }>;
  related: PublicProduct[];
  recentlyViewedEntry: RecentlyViewedEntry;
  /** schema.org Product document, built by the page. */
  jsonLd: Record<string, unknown>;
}

export type ThemePdpCompositionSlot = ComponentType<PdpCompositionProps>;

/* ------------------------------------------------------------------ */
/* CartPage — mounted by app/(store)/cart/page.tsx (server shell)     */
/* ------------------------------------------------------------------ */

/** The exact props CartPageClient takes today: the server shell's
 *  ACTIVE catalog (public shape) + the grocery weighted-pack
 *  annotations keyed by variantId. */
export interface ThemeCartPageProps {
  catalogProducts: PublicProduct[];
  weightedVariants?: Record<string, WeightedVariantAnnotation>;
}

export type ThemeCartPageSlot = ComponentType<ThemeCartPageProps>;

/* ------------------------------------------------------------------ */
/* CartDrawer — mounted by the client storefront shell                */
/* ------------------------------------------------------------------ */

/**
 * The slide-in cart drawer contract. A package's drawer owns its own
 * cart reads (the guest cart is browser-side) and renders over the
 * page while `open`; `onClose` must dismiss it. Aurora registers an
 * explicit null implementation — no drawer exists in Theme #1.
 */
export interface ThemeCartDrawerProps {
  open: boolean;
  onClose: () => void;
}

export type ThemeCartDrawerSlot = ComponentType<ThemeCartDrawerProps>;

/* ------------------------------------------------------------------ */
/* CheckoutSkin — NOT a component: the checkout page's class record   */
/* ------------------------------------------------------------------ */

/**
 * The checkout page funnels its field/tile styling through page-local
 * class constants (app/(store)/checkout/page.tsx). The skin is the
 * record of those constants: a package re-skins checkout by providing
 * different strings for the SAME keys. Checkout logic, fields,
 * validation and the submit path are platform code and never part of
 * any skin.
 *
 * Doc 32 P4 deepened the record with real surface tokens so a theme
 * can differentiate checkout's large surfaces, not just its fields:
 * the step section cards, the order-summary panel, the primary CTA,
 * and the sticky mobile summary bar (container + its CTA). The five
 * P4 keys are OPTIONAL on a package skin — the skin registry resolves
 * every key per key against Aurora's values (see skin-registry.ts),
 * so a package that provides only the original three keys renders
 * exactly as before. Layout/positioning classes (grid placement, the
 * summary rail's sticky offsets) stay page-owned and are NOT part of
 * the skin: the skin carries surface treatment only.
 */
export interface CheckoutSkin {
  INPUT_CLASS: string;
  PAYMENT_TILE_CLASS: string;
  SLOT_CARD_CLASS: string;
  /** Step section card surface (the four numbered checkout steps). */
  SECTION_CARD_CLASS?: string;
  /** Order-summary panel surface — surface only; the page appends
   *  its own sticky-rail positioning classes. */
  SUMMARY_PANEL_CLASS?: string;
  /** Primary CTA emphasis — the in-form place-order button. */
  PRIMARY_CTA_CLASS?: string;
  /** Sticky mobile summary bar container surface. */
  STICKY_BAR_CLASS?: string;
  /** The sticky bar's form-associated submit button. */
  STICKY_CTA_CLASS?: string;
}

/** A CheckoutSkin with every key resolved — the skin registry's
 *  output (each P4 key filled from Aurora when a package omits it). */
export type ResolvedCheckoutSkin = Required<CheckoutSkin>;

/* ------------------------------------------------------------------ */
/* Slot maps                                                          */
/* ------------------------------------------------------------------ */

/** Full slot map — resolved by server components (home page, PDP
 *  page, cart page). */
export interface ThemeSlots {
  Header: ThemeHeaderSlot;
  Footer: ThemeFooterSlot;
  HomeSections: ThemeHomeSectionsSlot;
  ProductCard: ThemeProductCardSlot;
  PdpComposition: ThemePdpCompositionSlot;
  CartPage: ThemeCartPageSlot;
}

/** Client-safe slot map — resolved by the client storefront shell. */
export interface ThemeShellSlots {
  Header: ThemeHeaderSlot;
  Footer: ThemeFooterSlot;
}
