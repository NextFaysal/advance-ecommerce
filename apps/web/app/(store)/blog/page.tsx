/**
 * /blog — storefront blog index (ADV-17, doc 22). Public posts only:
 * the read path in src/cms/blog.ts shows a post iff the CMS row is
 * PUBLISHED and not soft-deleted. Category filter + pagination run
 * through searchParams; with zero published posts the page renders
 * its honest "coming soon" state — no placeholder posts, ever.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { listBlogCategories, listPublishedPosts, type BlogPostSummary } from "@/cms/blog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ব্লগ — Advance Ecommerce",
  description: "কেনাকাটার টিপস, পণ্যের গাইড আর আমাদের গল্প — Advance Ecommerce ব্লগ।",
  openGraph: {
    title: "ব্লগ — Advance Ecommerce",
    description: "কেনাকাটার টিপস, পণ্যের গাইড আর আমাদের গল্প — Advance Ecommerce ব্লগ।",
    type: "website",
  },
};

function formatBlogDate(iso: string): string {
  return new Date(iso).toLocaleDateString("bn-BD", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function pageHref(page: number, category: string | null): string {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/blog?${qs}` : "/blog";
}

function PostCard({ post }: { post: BlogPostSummary }) {
  return (
    <article className="flex flex-col rounded-3xl border border-border bg-card p-6 shadow-card">
      {post.category ? (
        <Link
          href={`/blog?category=${encodeURIComponent(post.category)}`}
          className="w-fit rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100"
        >
          {post.category}
        </Link>
      ) : null}
      <h2 className="mt-3 font-display text-lg font-bold leading-snug text-text-main">
        <Link href={`/blog/${post.slug}`} className="transition hover:text-brand-700">
          {post.titleBn}
        </Link>
      </h2>
      <p className="mt-1.5 text-xs text-text-muted">
        {formatBlogDate(post.publishedDate)}
        {post.readingTimeMinutes > 0 ? <> · পড়তে {post.readingTimeMinutes.toLocaleString("bn-BD")} মিনিট</> : null}
      </p>
      <p className="mt-3 line-clamp-3 text-sm leading-7 text-text-muted">{post.excerpt}</p>
      <div className="mt-auto pt-4">
        <Link
          href={`/blog/${post.slug}`}
          className="text-sm font-semibold text-brand-700 underline-offset-2 transition hover:underline"
        >
          পুরোটা পড়ুন →
        </Link>
      </div>
    </article>
  );
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: { page?: string; category?: string };
}) {
  const category = searchParams.category?.trim() ? searchParams.category.trim() : null;
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const [{ posts, pagination }, categories] = await Promise.all([
    listPublishedPosts({ page, category }),
    listBlogCategories(),
  ]);
  const { totalPages } = pagination;

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

      {categories.length > 0 ? (
        <nav aria-label="ব্লগের বিষয়" className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/blog"
            className={`inline-flex min-h-[40px] items-center rounded-full px-4 text-sm font-semibold transition ${
              category === null
                ? "bg-brand-600 text-white shadow-sm"
                : "border border-border bg-card text-text-muted hover:text-text-main"
            }`}
          >
            সব
          </Link>
          {categories.map(({ category: name, count }) => (
            <Link
              key={name}
              href={`/blog?category=${encodeURIComponent(name)}`}
              className={`inline-flex min-h-[40px] items-center rounded-full px-4 text-sm font-semibold transition ${
                category === name
                  ? "bg-brand-600 text-white shadow-sm"
                  : "border border-border bg-card text-text-muted hover:text-text-main"
              }`}
            >
              {name} ({count.toLocaleString("bn-BD")})
            </Link>
          ))}
        </nav>
      ) : null}

      {posts.length === 0 ? (
        <section className="mt-10 rounded-3xl border border-dashed border-border bg-card p-10 text-center">
          <h2 className="font-display text-xl font-bold text-text-main">
            {category ? "এই বিষয়ে এখনো কোনো লেখা নেই" : "শীঘ্রই আসছে"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-text-muted">
            {category
              ? "অন্য বিষয়ের লেখাগুলো দেখুন — নতুন লেখা প্রকাশ হলেই এখানে পাবেন।"
              : "আমাদের প্রথম ব্লগ লেখাগুলো তৈরির কাজ চলছে। প্রকাশ হলেই সেগুলো এখানে দেখা যাবে — ততক্ষণ দোকান ঘুরে দেখুন!"}
          </p>
          <Link
            href={category ? "/blog" : "/shop"}
            className="mt-5 inline-flex min-h-[44px] items-center rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            {category ? "সব লেখা দেখুন" : "দোকানে যান"}
          </Link>
        </section>
      ) : (
        <>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>

          {totalPages > 1 ? (
            <nav aria-label="ব্লগ পেজিনেশন" className="mt-10 flex flex-wrap items-center justify-center gap-2">
              {pagination.page > 1 ? (
                <Link
                  href={pageHref(pagination.page - 1, category)}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-card px-4 text-sm font-semibold text-text-muted transition hover:text-text-main"
                >
                  ← আগের
                </Link>
              ) : null}
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <Link
                  key={n}
                  href={pageHref(n, category)}
                  aria-current={n === pagination.page ? "page" : undefined}
                  className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-3 text-sm font-semibold transition ${
                    n === pagination.page
                      ? "bg-brand-600 text-white shadow-sm"
                      : "border border-border bg-card text-text-muted hover:text-text-main"
                  }`}
                >
                  {n.toLocaleString("bn-BD")}
                </Link>
              ))}
              {pagination.page < totalPages ? (
                <Link
                  href={pageHref(pagination.page + 1, category)}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-card px-4 text-sm font-semibold text-text-muted transition hover:text-text-main"
                >
                  পরের →
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}
