/**
 * /kb/[slug] — one published knowledge-base article (ADV-16
 * remainder, doc 22). Unpublished or unknown slugs answer 404:
 * drafts never leak. Content is the plain-text body from the
 * `support.kb_articles` Setting doc, rendered as written (line
 * breaks preserved) — no markup is interpreted.
 *
 * Static shell with ISR (revalidate = 300), the wave-47 pattern.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedKbArticleSafe } from "@/support/docs";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const article = await getPublishedKbArticleSafe(params.slug);
  if (!article) return { title: "সাহায্য কেন্দ্র — Advance Ecommerce" };
  return {
    title: `${article.titleBn} — সাহায্য কেন্দ্র`,
    description: article.bodyBn.slice(0, 160),
  };
}

export default async function KbArticlePage({ params }: { params: { slug: string } }) {
  const article = await getPublishedKbArticleSafe(params.slug);
  if (!article) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <p className="text-sm">
        <Link
          href="/kb"
          className="focus-ring inline-flex min-h-[44px] items-center rounded-lg font-semibold text-brand-700 hover:underline"
        >
          ← সাহায্য কেন্দ্র
        </Link>
      </p>
      <h1 className="mt-3 font-display text-2xl font-bold leading-snug text-text-main">
        {article.titleBn}
      </h1>
      {article.titleEn ? (
        <p className="mt-1 text-sm text-text-subtle">{article.titleEn}</p>
      ) : null}

      <article className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-card">
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-text-main [overflow-wrap:anywhere]">
          {article.bodyBn}
        </p>
        {article.bodyEn ? (
          <>
            <h2 className="mt-8 border-t border-border pt-5 text-sm font-bold text-text-main">
              English
            </h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-text-main [overflow-wrap:anywhere]">
              {article.bodyEn}
            </p>
          </>
        ) : null}
      </article>

      <p className="mt-6 text-sm leading-6 text-text-muted">
        এই উত্তরে সমস্যার সমাধান না হলে{" "}
        <Link href="/account/tickets" className="font-semibold text-brand-700 hover:underline">
          সাপোর্ট টিকিট
        </Link>{" "}
        খুলুন।
      </p>
    </main>
  );
}
