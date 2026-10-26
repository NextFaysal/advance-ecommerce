/**
 * /robots.txt — public storefront crawlable; admin + API surfaces
 * are not for crawlers. Points at the ADV-17 sitemap.
 */
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/", "/pay/", "/sandbox/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
