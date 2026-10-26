/**
 * /blog/[slug] — one public blog post (ADV-17, doc 22).
 * Visibility: only a PUBLISHED, non-deleted CmsPost resolves here;
 * drafts/scheduled/deleted slugs 404 exactly like missing ones
 * (same privacy parity as the PDP). A renamed slug follows the
 * SeoRedirect row the CMS writes on rename → permanent redirect to
 * the new slug when the target post is itself public.
 * CmsPost has no author/cover-image columns — no byline or hero
 * image is shown rather than inventing one.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPublishedPostBySlug, getRelatedPosts } from "@/cms/blog";
import { cmsStore } from "@/reports/cms";
import { BlogBody } from "./BlogBody";

// Wave 52 (ISR conversion): a post page reads only the CMS row for
// its slug — no cookies, no searchParams, no per-visitor state — so
// it renders statically like the PDP: published slugs are pre-built
// by generateStaticParams below, new slugs render on demand
// (dynamicParams) and are then cached, and everything revalidates
// on a 300s window. A renamed slug still follows its SeoRedirect row
// and a missing/draft slug still 404s — both now resolve at render /
// revalidation time instead of on every request, so a rename or a
// fresh publish can take up to one window to show up here.
export const revalidate = 300;

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  try {
    const { prisma } = await import("@advance-ecommerce/db");
    const rows = await prisma.cmsPost.findMany({
      // The visibility contract from src/cms/blog.ts, mirrored:
      // public iff PUBLISHED and not soft-deleted.
      where: { status: "PUBLISHED", deletedAt: null },
      select: { slug: true },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    return rows.map((r) => ({ slug: r.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = await getPublishedPostBySlug(params.slug);
  if (!post) return { title: "লেখাটি পাওয়া যায়নি" };
  const title = post.seoTitle ?? post.titleBn;
  const description = post.seoDescription ?? post.excerpt;
  return {
    title: `${title} — Advance Ecommerce ব্লগ`,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      publishedTime: post.publishedDate,
      ...(post.category ? { section: post.category } : {}),
      tags: post.tags,
    },
    twitter: { card: "summary", title, description },
  };
}

function formatBlogDate(iso: string): string {
  return new Date(iso).toLocaleDateString("bn-BD", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = await getPublishedPostBySlug(params.slug);
  if (!post) {
    // Renamed in the CMS? Follow the recorded SEO redirect, but only
    // when the target is a live public post.
    const target = await cmsStore.resolveRedirect(params.slug).catch(() => null);
    if (target && target !== params.slug) {
      const targetPost = await getPublishedPostBySlug(target);
      if (targetPost) redirect(`/blog/${target}`);
    }
    notFound();
  }

  const related = await getRelatedPosts(post);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link href="/blog" className="text-sm font-semibold text-brand-700 underline-offset-2 transition hover:underline">
        ← সব লেখা
      </Link>

      <article className="mt-5 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
        {post.category ? (
          <Link
            href={`/blog?category=${encodeURIComponent(post.category)}`}
            className="w-fit rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100"
          >
            {post.category}
          </Link>
        ) : null}
        <h1 className="mt-3 font-display text-2xl font-extrabold leading-snug text-text-main sm:text-3xl">
          {post.titleBn}
        </h1>
        <p className="mt-2 text-xs text-text-muted">
          প্রকাশ: {formatBlogDate(post.publishedDate)}
          {post.readingTimeMinutes > 0 ? <> · পড়তে {post.readingTimeMinutes.toLocaleString("bn-BD")} মিনিট</> : null}
        </p>
        <div className="mt-6 border-t border-border pt-6">
          <BlogBody bnHtml={post.bodyBnHtml} enHtml={post.bodyEnHtml} />
        </div>
        {post.tags.length > 0 ? (
          <div className="mt-8 flex flex-wrap gap-2 border-t border-border pt-5">
            {post.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-text-muted">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
      </article>

      {related.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-display text-xl font-bold text-text-main">আরও পড়ুন</h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            {related.map((rel) => (
              <article key={rel.slug} className="flex flex-col rounded-3xl border border-border bg-card p-5 shadow-card">
                {rel.category ? (
                  <span className="w-fit rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700">
                    {rel.category}
                  </span>
                ) : null}
                <h3 className="mt-2 font-display text-base font-bold leading-snug text-text-main">
                  <Link href={`/blog/${rel.slug}`} className="transition hover:text-brand-700">
                    {rel.titleBn}
                  </Link>
                </h3>
                <p className="mt-1 text-xs text-text-muted">{formatBlogDate(rel.publishedDate)}</p>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-text-muted">{rel.excerpt}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
