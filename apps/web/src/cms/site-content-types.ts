// Site content — types, validation schemas and BUILT-IN DEFAULTS.
// Pure module (no Prisma, no server imports): the admin editor, the
// storefront shell and the server store (src/cms/site-content.ts) all
// import from here.
//
// What lives in "site content":
//   - header menu  — storefront top navigation (one level of children)
//   - footer menu  — storefront footer link groups
//   - hero slides  — homepage campaign slides (src/cms/HeroSlides)
//
// DEFAULTS POLICY (honesty rule): the DEFAULT_* constants below are
// the built-in fallback copy, used ONLY until the owner saves their
// own content in Admin → Content. They are code defaults, never
// presented as owner/CMS content — the APIs report
// `configured: false` while a section is still on defaults, and the
// storefront renders exactly these links in that state (the same
// links the shell used to hardcode — they moved here so there is a
// single source of truth).
import { z } from "zod";

/* ------------------------------ menus ------------------------------ */

export interface SiteMenuChild {
  id: string;
  labelBn: string;
  labelEn: string;
  /** Internal path ("/shop") or absolute URL ("https://…"). */
  href: string;
  visible: boolean;
}

export interface SiteMenuItem extends SiteMenuChild {
  children: SiteMenuChild[];
}

export interface FooterMenuLink {
  id: string;
  labelBn: string;
  labelEn: string;
  href: string;
  visible: boolean;
}

export interface FooterMenuGroup {
  id: string;
  headingBn: string;
  headingEn: string;
  visible: boolean;
  links: FooterMenuLink[];
}

/* ---------------------------- hero slides --------------------------- */

export interface HeroSlide {
  id: string;
  headlineBn: string;
  headlineEn: string;
  subtextBn: string;
  subtextEn: string;
  ctaLabelBn: string;
  ctaLabelEn: string;
  /** Internal path or absolute URL the CTA button points to. */
  ctaHref: string;
  /** Optional campaign image; null = the aurora visual composition. */
  imageUrl: string | null;
  active: boolean;
}

export interface SiteContent {
  headerMenu: SiteMenuItem[];
  footerMenu: FooterMenuGroup[];
  heroSlides: HeroSlide[];
}

/** Which sections the owner has actually saved (vs. built-in defaults). */
export interface SiteContentConfigured {
  headerMenu: boolean;
  footerMenu: boolean;
  heroSlides: boolean;
}

/* ----------------------------- defaults ----------------------------- */

// Exactly the links the storefront header hardcoded before the menu
// builder landed (SiteHeader NAV_LINKS) — Bn label shown, En stored.
export const DEFAULT_HEADER_MENU: SiteMenuItem[] = [
  { id: "hm-shop", labelBn: "দোকান", labelEn: "Shop", href: "/shop", visible: true, children: [] },
  { id: "hm-track", labelBn: "অর্ডার ট্র্যাক", labelEn: "Track Order", href: "/track", visible: true, children: [] },
  { id: "hm-faq", labelBn: "জিজ্ঞাসা", labelEn: "FAQ", href: "/faq", visible: true, children: [] },
  { id: "hm-blog", labelBn: "ব্লগ", labelEn: "Blog", href: "/blog", visible: true, children: [] },
  { id: "hm-contact", labelBn: "যোগাযোগ", labelEn: "Contact", href: "/contact", visible: true, children: [] },
];

// Exactly the link columns the storefront footer hardcoded before the
// menu builder landed (SiteFooter COLUMNS).
export const DEFAULT_FOOTER_MENU: FooterMenuGroup[] = [
  {
    id: "fm-shop", headingBn: "দোকান", headingEn: "Shop", visible: true,
    links: [
      { id: "fm-shop-all", labelBn: "সব পণ্য", labelEn: "All Products", href: "/shop", visible: true },
      { id: "fm-shop-search", labelBn: "পণ্য খুঁজুন", labelEn: "Search Products", href: "/search", visible: true },
      { id: "fm-shop-wishlist", labelBn: "উইশলিস্ট", labelEn: "Wishlist", href: "/wishlist", visible: true },
      { id: "fm-shop-compare", labelBn: "তুলনা করুন", labelEn: "Compare", href: "/compare", visible: true },
      { id: "fm-shop-recent", labelBn: "সম্প্রতি দেখা", labelEn: "Recently Viewed", href: "/recently-viewed", visible: true },
    ],
  },
  {
    id: "fm-help", headingBn: "সাহায্য", headingEn: "Help", visible: true,
    links: [
      { id: "fm-help-track", labelBn: "অর্ডার ট্র্যাক করুন", labelEn: "Track Your Order", href: "/track", visible: true },
      { id: "fm-help-faq", labelBn: "সাধারণ জিজ্ঞাসা", labelEn: "FAQ", href: "/faq", visible: true },
      { id: "fm-help-contact", labelBn: "যোগাযোগ", labelEn: "Contact", href: "/contact", visible: true },
      { id: "fm-help-shipping", labelBn: "ডেলিভারি নীতিমালা", labelEn: "Shipping Policy", href: "/shipping-policy", visible: true },
      { id: "fm-help-refund", labelBn: "রিটার্ন ও রিফান্ড", labelEn: "Returns & Refunds", href: "/refund-policy", visible: true },
    ],
  },
  {
    id: "fm-legal", headingBn: "আইনি", headingEn: "Legal", visible: true,
    links: [
      { id: "fm-legal-privacy", labelBn: "গোপনীয়তা নীতি", labelEn: "Privacy Policy", href: "/privacy", visible: true },
      { id: "fm-legal-terms", labelBn: "শর্তাবলি", labelEn: "Terms", href: "/terms", visible: true },
    ],
  },
  {
    id: "fm-about", headingBn: "আমাদের সম্পর্কে", headingEn: "About Us", visible: true,
    links: [
      { id: "fm-about-us", labelBn: "আমাদের কথা", labelEn: "Our Story", href: "/about", visible: true },
      { id: "fm-about-blog", labelBn: "ব্লগ", labelEn: "Blog", href: "/blog", visible: true },
    ],
  },
];

// No built-in slides: zero configured slides means the homepage hero
// renders its static editorial content — there is no "default campaign".
export const DEFAULT_HERO_SLIDES: HeroSlide[] = [];

/* ---------------------------- validation ---------------------------- */

const hrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((v) => v.startsWith("/") || v.startsWith("https://") || v.startsWith("http://"), {
    message: "href must be an internal path (/…) or an absolute http(s) URL",
  });

const menuChildSchema = z.object({
  id: z.string().min(1).max(80),
  labelBn: z.string().trim().min(1).max(120),
  labelEn: z.string().trim().max(120).default(""),
  href: hrefSchema,
  visible: z.boolean().default(true),
});

export const siteMenuItemSchema = menuChildSchema.extend({
  children: z.array(menuChildSchema).max(12).default([]),
});

export const footerMenuGroupSchema = z.object({
  id: z.string().min(1).max(80),
  headingBn: z.string().trim().min(1).max(120),
  headingEn: z.string().trim().max(120).default(""),
  visible: z.boolean().default(true),
  links: z.array(menuChildSchema).max(20),
});

export const heroSlideSchema = z.object({
  id: z.string().min(1).max(80),
  headlineBn: z.string().trim().min(1).max(200),
  headlineEn: z.string().trim().max(200).default(""),
  subtextBn: z.string().trim().max(500).default(""),
  subtextEn: z.string().trim().max(500).default(""),
  ctaLabelBn: z.string().trim().min(1).max(80),
  ctaLabelEn: z.string().trim().max(80).default(""),
  ctaHref: hrefSchema,
  imageUrl: z.string().trim().max(500).nullable().default(null),
  active: z.boolean().default(true),
});

export const siteContentInputSchema = z.object({
  headerMenu: z.array(siteMenuItemSchema).max(30),
  footerMenu: z.array(footerMenuGroupSchema).max(10),
  heroSlides: z.array(heroSlideSchema).max(12),
});
export type SiteContentInput = z.infer<typeof siteContentInputSchema>;

/* ------------------------- storefront shaping ------------------------ */

/** Visible-only view for the storefront: hidden items/groups/links and
 *  hidden children are dropped; array order is the display order. */
export function visibleHeaderMenu(items: readonly SiteMenuItem[]): SiteMenuItem[] {
  return items
    .filter((i) => i.visible)
    .map((i) => ({ ...i, children: i.children.filter((c) => c.visible) }));
}

export function visibleFooterMenu(groups: readonly FooterMenuGroup[]): FooterMenuGroup[] {
  return groups
    .filter((g) => g.visible)
    .map((g) => ({ ...g, links: g.links.filter((l) => l.visible) }))
    .filter((g) => g.links.length > 0);
}

export function activeHeroSlides(slides: readonly HeroSlide[]): HeroSlide[] {
  return slides.filter((s) => s.active);
}

let idCounter = 0;
/** New id for builder-created rows (client + server safe). */
export function newSiteContentId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}
