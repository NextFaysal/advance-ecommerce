"use client";

// Wave 52: the param-driven half of /blog, moved client-side for the
// ISR conversion (the shop page did the same in wave 47). The server
// shell hands over every published post summary + the category
// counts; this component reads ?category= / ?page= via
// useSearchParams and filters + paginates in-page. The URL contract
// is unchanged — category chips and pagination are plain Links, so
// filtered views stay shareable via soft navigation, and the slicing
// (9 per page) and clamping (page beyond the end shows the last page)
// replicate the old server behaviour exactly.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { BlogPostSummary } from "@/cms/blog";

/** Mirrors BLOG_PAGE_SIZE in src/cms/blog.ts (a runtime import of
 *  that module would pull Prisma into the client bundle, so the
 *  constant is restated here — keep the two in sync). */
const PAGE_SIZE = 9;

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

export function BlogBrowser({
  posts,
  categories,
}: {
  posts: BlogPostSummary[];
  categories: { category: string; count: number }[];
}) {
  const searchParams = useSearchParams();
  const categoryRaw = searchParams.get("category");
  const category = categoryRaw?.trim() ? categoryRaw.trim() : null;
  const requestedPage = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const filtered = category ? posts.filter((p) => p.category === category) : posts;
  // Same clamping as blogPagination() server-side: at least one page,
  // and a page past the end lands on the last page.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const pagePosts = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      {categories.length > 0 ? (
        <nav aria-label="ব্লগের বিষয়" className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/blog"
            className={`focus-ring inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold transition ${
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
              className={`focus-ring inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold transition ${
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

      {pagePosts.length === 0 ? (
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
            {pagePosts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>

          {totalPages > 1 ? (
            <nav aria-label="ব্লগ পেজিনেশন" className="mt-10 flex flex-wrap items-center justify-center gap-2">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1, category)}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-card px-4 text-sm font-semibold text-text-muted transition hover:text-text-main"
                >
                  ← আগের
                </Link>
              ) : null}
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <Link
                  key={n}
                  href={pageHref(n, category)}
                  aria-current={n === page ? "page" : undefined}
                  className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-3 text-sm font-semibold transition ${
                    n === page
                      ? "bg-brand-600 text-white shadow-sm"
                      : "border border-border bg-card text-text-muted hover:text-text-main"
                  }`}
                >
                  {n.toLocaleString("bn-BD")}
                </Link>
              ))}
              {page < totalPages ? (
                <Link
                  href={pageHref(page + 1, category)}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-card px-4 text-sm font-semibold text-text-muted transition hover:text-text-main"
                >
                  পরের →
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
