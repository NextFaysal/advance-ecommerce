// Site content store — DB-backed (Prisma `Setting` table).
//
// SCHEMA GAP (precise): the Prisma schema has NO Menu / SiteContent
// model (checked packages/db/prisma/schema.prisma — CmsPage, CmsPost,
// SeoRedirect and LandingPage exist; nothing for navigation menus or
// homepage slides, and this change may not migrate). The closest
// existing persistence the codebase already uses for storefront-facing
// configuration is the `Setting` key-value table, so each site-content
// section is stored there as one JSON document:
//
//   key "cms.menu.header"      -> SiteMenuItem[]   (isPublic, plain)
//   key "cms.menu.footer"      -> FooterMenuGroup[]
//   key "cms.home.hero_slides" -> HeroSlide[]
//
// A missing row (or an unreadable value) means "not configured": the
// reader falls back to the BUILT-IN DEFAULTS in site-content-types.ts
// and reports configured: false for that section — defaults are code,
// never passed off as saved CMS content. Writes are validated with
// the same zod schemas the admin API uses, so a stored value always
// parses back; a hand-corrupted row degrades to defaults, it never
// breaks the storefront.
import { prisma } from "@advance-ecommerce/db";
import {
  DEFAULT_FOOTER_MENU,
  DEFAULT_HEADER_MENU,
  DEFAULT_HERO_SLIDES,
  activeHeroSlides,
  footerMenuGroupSchema,
  heroSlideSchema,
  siteMenuItemSchema,
  visibleFooterMenu,
  visibleHeaderMenu,
  type FooterMenuGroup,
  type HeroSlide,
  type SiteContent,
  type SiteContentConfigured,
  type SiteMenuItem,
} from "./site-content-types";
import { z } from "zod";

export const SITE_CONTENT_KEYS = {
  headerMenu: "cms.menu.header",
  footerMenu: "cms.menu.footer",
  heroSlides: "cms.home.hero_slides",
} as const;

export interface SiteContentRead {
  content: SiteContent;
  configured: SiteContentConfigured;
}

function parseSection<T>(raw: string | null, schema: z.ZodType<T[], z.ZodTypeDef, unknown>, fallback: T[]): { items: T[]; configured: boolean } {
  if (raw === null || raw.trim() === "") return { items: fallback, configured: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (!result.success) return { items: fallback, configured: false };
    return { items: result.data, configured: true };
  } catch {
    return { items: fallback, configured: false };
  }
}

/** Full document as the admin editor needs it: invisible items and
 *  inactive slides included, defaults substituted per-section. */
export async function readSiteContent(): Promise<SiteContentRead> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(SITE_CONTENT_KEYS) } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.valueEncrypted ? null : r.value]));
  const header = parseSection<SiteMenuItem>(
    byKey.get(SITE_CONTENT_KEYS.headerMenu) ?? null, z.array(siteMenuItemSchema), DEFAULT_HEADER_MENU,
  );
  const footer = parseSection<FooterMenuGroup>(
    byKey.get(SITE_CONTENT_KEYS.footerMenu) ?? null, z.array(footerMenuGroupSchema), DEFAULT_FOOTER_MENU,
  );
  const slides = parseSection<HeroSlide>(
    byKey.get(SITE_CONTENT_KEYS.heroSlides) ?? null, z.array(heroSlideSchema), DEFAULT_HERO_SLIDES,
  );
  return {
    content: { headerMenu: header.items, footerMenu: footer.items, heroSlides: slides.items },
    configured: {
      headerMenu: header.configured,
      footerMenu: footer.configured,
      heroSlides: slides.configured,
    },
  };
}

/** Replace all three sections atomically-ish (three upserts; each key
 *  is independent, and the admin editor always saves the whole
 *  document). Input MUST already be validated by siteContentInputSchema
 *  (the admin route does); values are stored unencrypted + isPublic
 *  because menus/slides are rendered on the public storefront. */
export async function saveSiteContent(content: SiteContent, actorId: string): Promise<void> {
  const docs: Array<{ key: string; value: string; description: string }> = [
    { key: SITE_CONTENT_KEYS.headerMenu, value: JSON.stringify(content.headerMenu), description: "Storefront header menu (CMS site content, JSON)" },
    { key: SITE_CONTENT_KEYS.footerMenu, value: JSON.stringify(content.footerMenu), description: "Storefront footer menu groups (CMS site content, JSON)" },
    { key: SITE_CONTENT_KEYS.heroSlides, value: JSON.stringify(content.heroSlides), description: "Homepage hero campaign slides (CMS site content, JSON)" },
  ];
  for (const doc of docs) {
    await prisma.setting.upsert({
      where: { key: doc.key },
      create: {
        key: doc.key,
        value: doc.value,
        valueEncrypted: false,
        isPublic: true,
        description: doc.description,
        category: "general",
        updatedById: actorId,
      },
      update: { value: doc.value, valueEncrypted: false, isPublic: true, updatedById: actorId },
    });
  }
}

/** Storefront read: visible-filtered menus + active slides only.
 *  Fail-safe — any DB problem degrades to the built-in defaults so
 *  the shell/homepage never break (same convention as the catalog
 *  server reads). `configured` still reports what the DB said. */
export async function getStorefrontSiteContent(): Promise<SiteContentRead> {
  try {
    const { content, configured } = await readSiteContent();
    return {
      content: {
        headerMenu: visibleHeaderMenu(content.headerMenu),
        footerMenu: visibleFooterMenu(content.footerMenu),
        heroSlides: activeHeroSlides(content.heroSlides),
      },
      configured,
    };
  } catch {
    return {
      content: {
        headerMenu: visibleHeaderMenu(DEFAULT_HEADER_MENU),
        footerMenu: visibleFooterMenu(DEFAULT_FOOTER_MENU),
        heroSlides: [],
      },
      configured: { headerMenu: false, footerMenu: false, heroSlides: false },
    };
  }
}

/** Homepage helper: just the active slides (empty = static hero). */
export async function getActiveHeroSlides(): Promise<HeroSlide[]> {
  const { content } = await getStorefrontSiteContent();
  return content.heroSlides;
}
