/**
 * /sitemap.xml — created with ADV-17 (the app had no sitemap before):
 * core storefront routes + every ACTIVE product + every PUBLISHED
 * blog post (src/cms/blog.ts visibility contract). DB sections
 * degrade to the static routes when the DB is not ready.
 */
import type { MetadataRoute } from "next";
import { prisma } from "@advance-ecommerce/db";
import { listAllPublishedPostRefs } from "@/cms/blog";

export const dynamic = "force-dynamic";

const STATIC_ROUTES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/shop", priority: 0.9 },
  { path: "/blog", priority: 0.8 },
  { path: "/track", priority: 0.6 },
  { path: "/search", priority: 0.5 },
  { path: "/faq", priority: 0.5 },
  { path: "/contact", priority: 0.5 },
  { path: "/about", priority: 0.4 },
  { path: "/shipping-policy", priority: 0.3 },
  { path: "/refund-policy", priority: 0.3 },
  { path: "/privacy", priority: 0.2 },
  { path: "/terms", priority: 0.2 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map(({ path, priority }) => ({
    url: `${baseUrl}${path}`,
    priority,
  }));

  try {
    const products = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    for (const product of products) {
      entries.push({
        url: `${baseUrl}/product/${product.slug}`,
        lastModified: product.updatedAt,
        priority: 0.7,
      });
    }
  } catch {
    // DB not ready — static routes only, same honest-degrade pattern
    // as the catalog server reads.
  }

  const posts = await listAllPublishedPostRefs();
  for (const post of posts) {
    entries.push({
      url: `${baseUrl}/blog/${post.slug}`,
      lastModified: new Date(post.updatedAt),
      priority: 0.6,
    });
  }

  return entries;
}
