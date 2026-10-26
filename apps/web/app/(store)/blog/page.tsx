/**
 * /blog — storefront blog index (ADV-17, doc 22). Public posts only:
 * the read path in src/cms/blog.ts shows a post iff the CMS row is
 * PUBLISHED and not soft-deleted. With zero published posts the page
 * renders its honest "coming soon" state — no placeholder posts, ever.
 *
 * Wave 52 (ISR conversion): this index used to render per-request
 * because category filtering + pagination ran through searchParams
 * on the server. The page itself carries no per-visitor state, so it
 * is now an ISR shell: the server fetches every published post
 * summary once (capped at BLOG_INDEX_FETCH_LIMIT, the same 500 cap
 * the PDP uses for generateStaticParams) plus the category counts,
 * and the client BlogBrowser applies the ?category= / ?page= URL
 * contract over that payload — the URLs, the 9-per-page slicing and
 * the page clamping behave exactly as the server version did.
 * Trade-off, stated plainly: a store blog with more than 500
 * published posts would need the cap raised (or a public posts API)
 * for the oldest posts to appear in this index; their /blog/[slug]
 * pages are unaffected.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { listBlogCategories, listPublishedPosts } from "@/cms/blog";
import { BlogBrowser } from "./BlogBrowser";

export const revalidate = 300;

/** How many published summaries the shell ships to the client
 *  browser for in-page filtering/pagination. Mirrors the PDP's
 *  generateStaticParams cap (500). */
const BLOG_INDEX_FETCH_LIMIT = 500;

export const metadata: Metadata = {
  title: "ব্লগ — Advance Ecommerce",
  description: "কেনাকাটার টিপস, পণ্যের গাইড আর আমাদের গল্প — Advance Ecommerce ব্লগ।",
  openGraph: {
    title: "ব্লগ — Advance Ecommerce",
    description: "কেনাকাটার টিপস, পণ্যের গাইড আর আমাদের গল্প — Advance Ecommerce ব্লগ।",
    type: "website",
  },
};

export default async function BlogIndexPage() {
  const [{ posts }, categories] = await Promise.all([
    listPublishedPosts({ page: 1, pageSize: BLOG_INDEX_FETCH_LIMIT }),
    listBlogCategories(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-text-main">ব্লগ</h1>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-text-muted">
          কেনাকাটার টিপস, পণ্যের গাইড, অফারের খবর আর আমাদের গল্প — সব এখানে।
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text-muted">
          <a href="/blog/feed.xml" className="font-medium text-brand-700 underline-offset-2 hover:underline">
            RSS ফিড
          </a>
        </div>
      </header>

      <Suspense fallback={null}>
        <BlogBrowser posts={posts} categories={categories} />
      </Suspense>
    </main>
  );
}
