// Site content write validation — SERVER ONLY (perf wave, zod diet).
//
// These zod schemas used to live in ./site-content-types next to the
// shared types + built-in defaults. The storefront shell and theme
// headers/footers (client components) import those types/defaults,
// which dragged the zod runtime into the browser bundle. The schemas
// now live here; ./site-content-types stays schema-free so client
// components can import it safely.
//
// Server validation is unchanged: the server store (./site-content)
// and the admin site-content API route import the exact same schema
// objects from this module instead.
import { z } from "zod";

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
